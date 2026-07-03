/**
 * DEV-ONLY seed logic. Shared between the /dev/seed page server action and the curl-friendly
 * /api/dev/seed POST. Wipes (TRUNCATE) and recreates a small click-through-ready dataset.
 *
 * Identity:
 *   - Persons: Eleanor (narrator role), Sofia + Marco (member/steward roles). Every Person has an
 *     Account — "narrator" vs "asker" is a role, not an account distinction. All can sign into the hub.
 *   - Family: Boudreaux, with all three active members
 *
 * Sample content (every write goes through the audited core path; storage-first ordering):
 *   - Five Stories approved+shared at family tier (visible in /hub when signed in as Sofia/Marco/Eleanor)
 *   - Four pending Asks for Eleanor (Sofia × 2, Marco × 2) so her "Questions for you" tab has a queue
 *   - One `pending_approval` Story linked to the first Ask (with AI-cleaned prose) — hub shows "Review & approve" immediately for that ask
 *   - One link session for Eleanor (convenience deep-link / magic-link test; NOT the primary UI entry)
 *
 * Sign-in is the headline entry point: /dev/sign-in (one-click) or /sign-in with credentials.
 *
 * Auth modes:
 *   - Mock mode (default when Clerk keys are absent): personas use `dev:xxx` authProviderUserId and
 *     get a `mock_auth_users` credential row for email+password sign-in at /sign-in.
 *   - Clerk mode (when isClerkConfigured()): personas are bound to pre-created Clerk test users via
 *     `getUserList({ emailAddress })`. The real Clerk userId is stored as `authProviderUserId`;
 *     `mock_auth_users` is never written. A persona with no matching Clerk user is skipped with a
 *     warning — never half-bound. If any CORE persona (Eleanor/Sofia/Marco) is missing from Clerk,
 *     the family content block is skipped entirely.
 *
 * All persona emails use the `+clerk_test@example.com` convention uniformly (one source of truth):
 *   - Mock mode: email+password sign-in (the email value itself is arbitrary).
 *   - Clerk mode: Clerk bypasses delivery for these addresses; verification code is always 424242.
 *
 * TRUNCATE bypasses the BEFORE UPDATE/DELETE triggers on consent_records/media, so re-running
 * this seed cleanly resets the dataset without fighting the immutability invariants.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { resetSchema } from "@chronicle/db";
import {
  accounts,
  families,
  memberships,
  persons,
} from "@chronicle/db/schema";
import {
  appendProseRevision,
  approveAndShareStory,
  createAsk,
  createInvitation,
  createJoinRequest,
  persistRecordingAndCreateDraft,
  transitionStoryState,
  updateDerivedFields,
} from "@chronicle/core";
import { createLinkSession } from "@chronicle/capture";
import { getRuntime } from "./runtime";
import { tinyWav } from "./wav-util";
import { seedMockCredential } from "./auth-mock";
import { isClerkConfigured } from "./clerk-config";
import { getClerkUserIdByEmail } from "./clerk-server";
import type { GetClerkUserIdByEmail } from "./clerk-server";

/** Shared dev password handed to every seeded account credential (mock mode only). */
const SEED_PASSWORD = "password";

const SAMPLE_AUDIO_CONTENT_TYPE = "audio/wav";

function checksumOf(bytes: Uint8Array): string {
  return `seed:${bytes.byteLength}:${randomUUID()}`;
}

export interface SeedResult {
  /** Eleanor's link-session token. Usable via /s/<token> for magic-link tests;
   *  NOT presented as the primary entry on the seed page — sign-in is the headline path.
   *  Undefined if the family content block was skipped (Clerk mode + core persona missing). */
  narratorToken?: string;
  /** Eleanor's Person id. Undefined if Eleanor was skipped (Clerk mode + no matching Clerk user). */
  narratorPersonId?: string;
  /** Eleanor's one seeded ask-linked story in `pending_approval` with AI-cleaned prose.
   *  The hub's Questions tab shows "Review & approve" immediately for the linked Ask when signed in
   *  as Eleanor. Named `draftStoryId` for historical continuity; the story is no longer in draft.
   *  Undefined if the family content block was skipped. */
  draftStoryId?: string;
  /** Sofia's email — the steward account. Mock mode: sign in at /sign-in with this + seedPassword.
   *  Clerk mode: sign in via Clerk with this email (verification code: 424242). */
  stewardSignInEmail: string;
  /** The shared password for every seeded credential in mock mode. Clerk mode: use code 424242. */
  seedPassword: string;
  /** The discoverable Boudreaux family — drives family-search + the steward requests surface.
   *  Undefined if the family content block was skipped. */
  boudreauxFamilyId?: string;
  /** The non-member who has a PENDING join request to Boudreaux awaiting Sofia's approval.
   *  Undefined if Theo was skipped (Clerk mode + no matching Clerk user) or family was skipped. */
  theoJoinRequestPersonId?: string;
  /** Raw token for a PENDING member invitation to Boudreaux — feeds a working /join/<token> link.
   *  Undefined if the family content block was skipped. */
  memberInviteToken?: string;
}

/**
 * Options for {@link seedInto}. Both overrides exist so tests can drive Clerk mode with a stub
 * resolver without importing Clerk or hitting the network.
 */
export interface SeedOpts {
  /** Override the Clerk-configured detection. Default: `isClerkConfigured()`. */
  clerkConfigured?: boolean;
  /** Override the Clerk email→userId resolver. Default: the real `getClerkUserIdByEmail`. */
  getClerkUserIdByEmail?: GetClerkUserIdByEmail;
}

interface ExtraStorySpec {
  promptQuestion: string;
  transcript: string;
  prose: string;
  title: string;
  summary: string;
  tags: string[];
  /** Back-dates createdAt/approvedAt so the Era (decade) facet has real spread. */
  occurredAt: Date;
  /** The historical year the story is ABOUT — drives the Era facet/label. */
  eraYear: number;
  /** Optional human display note for the era/place. */
  eraLabel?: string;
}

/**
 * Create → derive → approve+share a story for a narrator, then back-date its timeline so the hub's
 * Era facet spans real decades. Dates are stamped via a raw SQL UPDATE — the documented dev-only
 * bypass; production never backdates a story.
 */
async function seedApprovedStory(
  db: Awaited<ReturnType<typeof getRuntime>>["db"],
  storage: Awaited<ReturnType<typeof getRuntime>>["storage"],
  narratorPersonId: string,
  spec: ExtraStorySpec,
): Promise<void> {
  const audio = tinyWav();
  const key = `story-audio/${narratorPersonId}/${randomUUID()}.wav`;
  await storage.put({ key, bytes: audio, contentType: SAMPLE_AUDIO_CONTENT_TYPE });
  const { story } = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId: narratorPersonId,
      storageKey: key,
      contentType: SAMPLE_AUDIO_CONTENT_TYPE,
      durationSeconds: 1,
      checksum: checksumOf(audio),
    },
    { promptQuestion: spec.promptQuestion },
  );
  await updateDerivedFields(db, story.id, {
    transcript: spec.transcript,
    prose: spec.prose,
    title: spec.title,
    summary: spec.summary,
    tags: spec.tags,
    eraYear: spec.eraYear,
    eraLabel: spec.eraLabel ?? null,
  });
  await transitionStoryState(db, story.id, "pending_approval");
  const approvalAudio = tinyWav();
  const approvalKey = `approval-audio/${narratorPersonId}/${randomUUID()}.wav`;
  await storage.put({
    key: approvalKey,
    bytes: approvalAudio,
    contentType: SAMPLE_AUDIO_CONTENT_TYPE,
  });
  await approveAndShareStory(db, {
    storyId: story.id,
    narratorPersonId,
    audienceTier: "family",
    approvalAudio: {
      storageKey: approvalKey,
      contentType: SAMPLE_AUDIO_CONTENT_TYPE,
      checksum: checksumOf(approvalAudio),
      durationSeconds: 1,
    },
  });
  const iso = spec.occurredAt.toISOString();
  await db.execute(sql`
    UPDATE stories
    SET created_at = ${iso}, approved_at = ${iso}
    WHERE id = ${story.id}
  `);
}

export async function runSeed(): Promise<SeedResult> {
  const { db, storage } = await getRuntime();
  return seedInto(db, storage);
}

/**
 * The seed itself, against an injected db + storage. Split out from {@link runSeed} so it can run
 * against a test database (see dev-seed.test.ts) without going through getRuntime's persistent
 * PGlite + filesystem store.
 *
 * The optional {@link SeedOpts} let tests drive Clerk mode without real Clerk keys or network calls:
 * pass `{ clerkConfigured: true, getClerkUserIdByEmail: stub }` to exercise the binding logic
 * against a deterministic stub.
 */
export async function seedInto(
  db: Awaited<ReturnType<typeof getRuntime>>["db"],
  storage: Awaited<ReturnType<typeof getRuntime>>["storage"],
  opts?: SeedOpts,
): Promise<SeedResult> {
  // Single-schema dev model: blow the whole DB away and re-apply the CURRENT schema, rather than
  // TRUNCATE-ing a fixed table list. This means a schema change (edit src/schema.ts → regenerate)
  // lands on the very next reseed with no migration bookkeeping and no stale-state archaeology.
  await resetSchema(db);

  const usingClerk = opts?.clerkConfigured ?? isClerkConfigured();
  // Wrap the real getClerkUserIdByEmail so its optional second arg stays internal.
  const lookupClerkId: GetClerkUserIdByEmail =
    opts?.getClerkUserIdByEmail ?? ((email) => getClerkUserIdByEmail(email));

  // --- Clerk mode: resolve all Clerk userIds BEFORE any DB writes -------------------------
  // Null means no matching Clerk user exists for that email → persona skipped.
  // Never create an Account with a fabricated authProviderUserId (never half-bind).
  let eleanorAuthId: string | null = "dev:eleanor";
  let sofiaAuthId: string | null = "dev:sofia";
  let marcoAuthId: string | null = "dev:marco";
  let theoAuthId: string | null = "dev:theo";

  if (usingClerk) {
    [eleanorAuthId, sofiaAuthId, marcoAuthId, theoAuthId] = await Promise.all([
      lookupClerkId("eleanor+clerk_test@example.com"),
      lookupClerkId("sofia+clerk_test@example.com"),
      lookupClerkId("marco+clerk_test@example.com"),
      lookupClerkId("theo+clerk_test@example.com"),
    ]);

    const coreMissing: string[] = [
      eleanorAuthId === null ? "Eleanor (eleanor+clerk_test@example.com)" : null,
      sofiaAuthId === null ? "Sofia (sofia+clerk_test@example.com)" : null,
      marcoAuthId === null ? "Marco (marco+clerk_test@example.com)" : null,
    ].filter((m): m is string => m !== null);

    if (coreMissing.length > 0) {
      console.warn(
        `[dev-seed] Clerk mode: core persona(s) not found in Clerk — the family demo cannot be ` +
        `built. Missing: ${coreMissing.join(", ")}. ` +
        `Pre-create these test users in the Clerk dashboard (email + code 424242), then reseed. ` +
        `Family content block will be skipped.`,
      );
    }
    if (theoAuthId === null) {
      console.warn(
        `[dev-seed] Clerk mode: Theo (theo+clerk_test@example.com) not found in Clerk — ` +
        `skipping Theo persona and join request.`,
      );
    }
  }

  // Can the full family demo be built? Requires all three core personas to have auth IDs.
  const canBuildFamily =
    eleanorAuthId !== null && sofiaAuthId !== null && marcoAuthId !== null;

  // --- Core personas: Eleanor, Sofia, Marco -----------------------------------------------
  // Each is created only when its authId is non-null (always in mock mode; conditional in Clerk
  // mode). In Clerk mode the real Clerk userId is the authProviderUserId; seedMockCredential is
  // skipped because Clerk owns the credential store.

  let eleanor: { id: string } | undefined;
  let sofia: { id: string } | undefined;
  let marco: { id: string } | undefined;

  if (eleanorAuthId !== null) {
    const [p] = await db
      .insert(persons)
      .values({
        displayName: "Eleanor Boudreaux",
        spokenName: "Eleanor",
        // Profile reconciled with the real Clerk test user (eleanor+clerk_test@example.com): the
        // live-entered birth year + intake biographical_anchors win over the old seed values, and
        // the seeded stories below were rewritten to fit this 1956 Zachary→IBM→New Orleans life.
        birthYear: 1956,
        biographicalAnchors: {
          hometown: "Zachary, LA",
          siblingContext: "Youngest of five",
          currentLocation:
            "New Orleans — moved from Mandeville in 2017, previously lived in Raleigh, NC from 1987-1991",
          occupationSummary:
            "Worked at IBM and in the IBM ecosystem for most of their life, holding roles in development and sales.",
          hasChildren: true,
          hasGrandchildren: true,
        },
      })
      .returning();
    const [a] = await db
      .insert(accounts)
      .values({
        authProviderUserId: eleanorAuthId,
        email: "eleanor+clerk_test@example.com",
        displayName: "Eleanor Boudreaux",
      })
      .returning();
    await db.update(persons).set({ accountId: a!.id }).where(eq(persons.id, p!.id));
    eleanor = p;
  }

  if (sofiaAuthId !== null) {
    const [p] = await db
      .insert(persons)
      .values({
        displayName: "Sofia Boudreaux",
        spokenName: "Sofia",
        birthYear: 1988,
      })
      .returning();
    const [a] = await db
      .insert(accounts)
      .values({
        authProviderUserId: sofiaAuthId,
        email: "sofia+clerk_test@example.com",
        displayName: "Sofia Boudreaux",
      })
      .returning();
    await db.update(persons).set({ accountId: a!.id }).where(eq(persons.id, p!.id));
    sofia = p;
  }

  if (marcoAuthId !== null) {
    const [p] = await db
      .insert(persons)
      .values({
        displayName: "Marco Boudreaux",
        spokenName: "Marco",
        birthYear: 1985,
      })
      .returning();
    const [a] = await db
      .insert(accounts)
      .values({
        authProviderUserId: marcoAuthId,
        email: "marco+clerk_test@example.com",
        displayName: "Marco Boudreaux",
      })
      .returning();
    await db.update(persons).set({ accountId: a!.id }).where(eq(persons.id, p!.id));
    marco = p;
  }

  // --- Early exit: family demo cannot be built -------------------------------------------
  // If any core persona is missing (Clerk mode without matching test users), skip the entire
  // family content block. Seeded personas still have their Account/Person rows; only the family
  // graph and all dependent content are absent.
  if (!canBuildFamily) {
    return {
      narratorPersonId: eleanor?.id,
      stewardSignInEmail: "sofia+clerk_test@example.com",
      seedPassword: SEED_PASSWORD,
    };
  }

  // From here: eleanor, sofia, marco are all non-null (TypeScript doesn't narrow through
  // canBuildFamily, so we assert — consistent with the mock-mode non-null pattern throughout).
  const eleanorId = eleanor!.id;
  const sofiaId = sofia!.id;
  const marcoId = marco!.id;

  const [family] = await db
    .insert(families)
    .values({
      name: "Boudreaux",
      creatorPersonId: sofiaId,
      stewardPersonId: sofiaId,
    })
    .returning();
  await db.insert(memberships).values([
    {
      personId: eleanorId,
      familyId: family!.id,
      role: "narrator",
      status: "active",
    },
    {
      personId: sofiaId,
      familyId: family!.id,
      role: "member",
      status: "active",
    },
    {
      personId: marcoId,
      familyId: family!.id,
      role: "steward",
      status: "active",
    },
  ]);

  // Four pending Asks for Eleanor so her "Questions for you" tab has a real queue.
  // The FIRST ask is the one the seeded pending_approval story answers (askId=ask1.id).
  const ask1 = await createAsk(
    db,
    { kind: "account", personId: sofiaId },
    {
      targetPersonId: eleanorId,
      familyId: family!.id,
      questionText: "Grandma, what's your earliest memory of your own grandmother?",
    },
  );
  await createAsk(
    db,
    { kind: "account", personId: sofiaId },
    {
      targetPersonId: eleanorId,
      familyId: family!.id,
      questionText:
        "What's the best meal you remember from your childhood? Can you describe it?",
    },
  );
  await createAsk(
    db,
    { kind: "account", personId: marcoId },
    {
      targetPersonId: eleanorId,
      familyId: family!.id,
      questionText:
        "Tell me about a time you felt really proud of one of your children.",
    },
  );
  await createAsk(
    db,
    { kind: "account", personId: marcoId },
    {
      targetPersonId: eleanorId,
      familyId: family!.id,
      questionText:
        "What do you wish you'd known when you were twenty years old?",
    },
  );

  // One ask-linked story for Eleanor in `pending_approval` with AI-cleaned prose — the render
  // pipeline now runs at record time (not approval), so a recorded answer lands here ready for the
  // narrator to read/edit on the Questions-tab "Review & approve" screen.
  const draftAudio = tinyWav();
  const draftKey = `story-audio/${eleanorId}/${randomUUID()}.wav`;
  await storage.put({
    key: draftKey,
    bytes: draftAudio,
    contentType: SAMPLE_AUDIO_CONTENT_TYPE,
  });
  const { story: draftStory } = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId: eleanorId,
      storageKey: draftKey,
      contentType: SAMPLE_AUDIO_CONTENT_TYPE,
      durationSeconds: 1,
      checksum: checksumOf(draftAudio),
    },
    { promptQuestion: ask1.questionText, askId: ask1.id },
  );
  // Simulate the render pipeline: L1 (transcribed) → L2 (AI-cleaned) → pending_approval.
  const askAnswerTranscript =
    "Oh, my grandmother. Her name was Odette and she lived just up the road from us in Zachary. " +
    "She used to say she could read the coming weather right off the pecan trees. " +
    "I must have been four or five the first time she let me help her shell butter beans on the porch. " +
    "I can still smell that afternoon.";
  const askAnswerProse =
    "Her name was Odette, and she lived just up the road from us in Zachary. She used to say she could " +
    "read the coming weather right off the pecan trees — and I believed her. My earliest memory of her is " +
    "sitting on her porch, four or five years old, helping shell butter beans in the afternoon heat. I can " +
    "still smell that afternoon.";
  await appendProseRevision(db, {
    storyId: draftStory.id,
    level: "ai_transcribed",
    text: askAnswerTranscript,
    modelId: "mock-whisper-turbo",
  });
  await appendProseRevision(db, {
    storyId: draftStory.id,
    level: "ai_cleaned",
    text: askAnswerProse,
    modelId: "mock-claude",
    promptText: "[dev-seed] representative render system prompt",
  });
  await updateDerivedFields(db, draftStory.id, {
    transcript: askAnswerTranscript,
    prose: askAnswerProse,
    title: "My grandmother Odette",
    summary: "Eleanor's earliest memory of her grandmother shelling butter beans on a Zachary porch.",
    tags: ["grandparents", "childhood", "louisiana"],
    eraYear: 1961,
    eraLabel: "Zachary",
  });
  await transitionStoryState(db, draftStory.id, "pending_approval");

  // --- Onboarding + family-flow demo data --------------------------------------------------
  // Give Eleanor + Sofia + Marco real login credentials (the mock provider plays Clerk locally) so
  // the /sign-in flow works, and mark them already-onboarded (onboarded_at + birth_date set) so they
  // land straight on the hub instead of the /welcome onboarding gate. In Clerk mode, Clerk owns the
  // credentials — seedMockCredential is skipped.
  if (!usingClerk) {
    // In mock mode eleanorAuthId/sofiaAuthId/marcoAuthId are always non-null "dev:xxx" strings;
    // TypeScript cannot narrow them through canBuildFamily, so we assert here.
    await seedMockCredential(db, {
      email: "eleanor+clerk_test@example.com",
      password: SEED_PASSWORD,
      authProviderUserId: eleanorAuthId!,
    });
    await seedMockCredential(db, {
      email: "sofia+clerk_test@example.com",
      password: SEED_PASSWORD,
      authProviderUserId: sofiaAuthId!,
    });
    await seedMockCredential(db, {
      email: "marco+clerk_test@example.com",
      password: SEED_PASSWORD,
      authProviderUserId: marcoAuthId!,
    });
  }
  await db
    .update(persons)
    .set({ onboardedAt: sql`now()`, birthDate: "1956-12-18" })
    .where(eq(persons.id, eleanorId));
  await db
    .update(persons)
    .set({ onboardedAt: sql`now()`, birthDate: "1988-03-12" })
    .where(eq(persons.id, sofiaId));
  await db
    .update(persons)
    .set({ onboardedAt: sql`now()`, birthDate: "1985-07-22" })
    .where(eq(persons.id, marcoId));

  // Make Boudreaux discoverable with a blurb so the family-search demo returns a real hit.
  await db
    .update(families)
    .set({
      discoverable: true,
      description:
        "The Boudreaux family of Zachary and New Orleans, Louisiana — from butter-bean porches " +
        "to IBM sales floors, telling their stories across the decades.",
    })
    .where(eq(families.id, family!.id));

  // A non-member (Theo) with a PENDING join request, so Sofia (the steward) has one to approve.
  // In Clerk mode, Theo is skipped if no matching Clerk user was found.
  let theo: { id: string } | undefined;
  if (theoAuthId !== null) {
    const [p] = await db
      .insert(persons)
      .values({ displayName: "Theo Marchetti", spokenName: "Theo" })
      .returning();
    const [a] = await db
      .insert(accounts)
      .values({
        authProviderUserId: theoAuthId,
        email: "theo+clerk_test@example.com",
        displayName: "Theo Marchetti",
      })
      .returning();
    await db.update(persons).set({ accountId: a!.id }).where(eq(persons.id, p!.id));
    if (!usingClerk) {
      await seedMockCredential(db, {
        email: "theo+clerk_test@example.com",
        password: SEED_PASSWORD,
        authProviderUserId: theoAuthId,
      });
    }
    await createJoinRequest(db, {
      familyId: family!.id,
      requesterPersonId: p!.id,
      message:
        "Hi Sofia — I'm your cousin Theo from the Marchetti side, hoping to follow Eleanor's stories.",
    });
    theo = p;
  }

  // A PENDING member invitation to someone not yet in the system — its raw token feeds a working
  // /join/<token> welcome link. Sofia (an active member) is the inviter.
  const { token: memberInviteToken } = await createInvitation(db, {
    familyId: family!.id,
    inviterPersonId: sofiaId,
    inviteeName: "Maya Boudreaux",
    inviteeEmail: "maya+clerk_test@example.com",
    relationshipLabel: "Sofia's cousin",
  });

  const { token } = await createLinkSession(db, {
    personId: eleanorId,
    familyId: family!.id,
    invitedByPersonId: sofiaId,
  });

  // Story 1 — approved+shared at family tier (visible on the hub).
  const storyAudio = tinyWav();
  const storyKey = `story-audio/${eleanorId}/${randomUUID()}.wav`;
  await storage.put({
    key: storyKey,
    bytes: storyAudio,
    contentType: SAMPLE_AUDIO_CONTENT_TYPE,
  });
  const { story } = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId: eleanorId,
      storageKey: storyKey,
      contentType: SAMPLE_AUDIO_CONTENT_TYPE,
      durationSeconds: 1,
      checksum: checksumOf(storyAudio),
    },
    { promptQuestion: "Tell me about the house you grew up in." },
  );
  await updateDerivedFields(db, story.id, {
    transcript:
      "The house on Plank Road had a wide front porch where my mother kept her ferns. " +
      "Being the youngest of five, I learned early to slip out onto that porch when the house got too loud. " +
      "In the summer the cicadas would start up at dusk and you could hear them from the kitchen.",
    prose:
      "The house on Plank Road had a wide front porch where my mother kept her ferns. As the youngest " +
      "of five, I learned early to slip out onto that porch when the house got too loud. In summer the " +
      "cicadas started up at dusk, loud enough to carry all the way into the kitchen.",
    title: "The porch on Plank Road",
    summary: "Eleanor, the youngest of five, remembers her mother's ferns and the cicadas at dusk in Zachary.",
    tags: ["childhood", "house", "louisiana"],
    eraYear: 1964,
    eraLabel: "Zachary",
  });
  await transitionStoryState(db, story.id, "pending_approval");
  const approvalAudio = tinyWav();
  const approvalKey = `approval-audio/${eleanorId}/${randomUUID()}.wav`;
  await storage.put({
    key: approvalKey,
    bytes: approvalAudio,
    contentType: SAMPLE_AUDIO_CONTENT_TYPE,
  });
  await approveAndShareStory(db, {
    storyId: story.id,
    narratorPersonId: eleanorId,
    audienceTier: "family",
    approvalAudio: {
      storageKey: approvalKey,
      contentType: SAMPLE_AUDIO_CONTENT_TYPE,
      checksum: checksumOf(approvalAudio),
      durationSeconds: 1,
    },
  });
  // Back-date Story 1 into the 1950s so the Era facet spans real decades (dev-only).
  {
    const iso = new Date("1964-06-15T00:00:00Z").toISOString();
    await db.execute(sql`
      UPDATE stories
      SET created_at = ${iso}, approved_at = ${iso}
      WHERE id = ${story.id}
    `);
  }

  // Extra approved stories — give the hub finder real facet spread (Person/Era/Topic) and
  // enough cards to fill the "Earlier memories" grid.
  const extras: ExtraStorySpec[] = [
    {
      promptQuestion: "How did you and Grandpa meet?",
      transcript: "We met at a dance in the fall of 1977, right after I'd started at IBM. He couldn't dance a step, but he made me laugh.",
      prose:
        "We met at a dance in the autumn of 1977, not long after I'd started at IBM. He couldn't dance a single step to save his life, but he made me laugh so hard I forgot to mind my own feet.",
      title: "The dance where I met your grandfather",
      summary: "Eleanor remembers the 1977 dance where she met Grandpa — and how badly he danced.",
      tags: ["marriage", "family", "louisiana"],
      occurredAt: new Date("1977-10-12T00:00:00Z"),
      eraYear: 1977,
      eraLabel: "the dance hall",
    },
    {
      promptQuestion: "What was your wedding day like?",
      transcript: "We married in the spring of 1979. It rained, and everyone said that was good luck.",
      prose:
        "We married on a wet morning in the spring of 1979. It poured the whole way to the church, and every aunt I had told me rain on your wedding day was the best luck a marriage could ask for.",
      title: "Rain on the wedding",
      summary: "A rainy 1979 wedding that the whole family swore was good luck.",
      tags: ["marriage", "family"],
      occurredAt: new Date("1979-04-06T00:00:00Z"),
      eraYear: 1979,
    },
    {
      promptQuestion: "Tell me about the year the children were born.",
      transcript: "Your father was born in 1981, and our little place got a lot louder after that.",
      prose:
        "Your father came along in 1981, and our little place got a great deal louder — and a great deal happier — overnight.",
      title: "The house gets louder",
      summary: "Eleanor on the year her first child was born.",
      tags: ["birth", "family", "house"],
      occurredAt: new Date("1981-07-22T00:00:00Z"),
      eraYear: 1981,
    },
    {
      promptQuestion: "What work did you do?",
      transcript: "I spent my whole career at IBM — started in development, then moved into sales. We even spent a few years up in Raleigh, at Research Triangle Park, from '87 to '91.",
      prose:
        "I spent nearly my whole working life at IBM. I started out in development, writing and testing, then found I was even better at sales. The job took us all over — we even spent a few years up in Raleigh, at Research Triangle Park, from 1987 to 1991, before Louisiana pulled us home.",
      title: "The IBM years",
      summary: "Eleanor's career at IBM — from development to sales, including the Raleigh years at Research Triangle Park.",
      tags: ["work", "ibm", "career"],
      occurredAt: new Date("1989-09-03T00:00:00Z"),
      eraYear: 1989,
      eraLabel: "Research Triangle Park",
    },
  ];
  for (const spec of extras) {
    await seedApprovedStory(db, storage, eleanorId, spec);
  }

  return {
    narratorToken: token,
    narratorPersonId: eleanorId,
    draftStoryId: draftStory.id,
    stewardSignInEmail: "sofia+clerk_test@example.com",
    seedPassword: SEED_PASSWORD,
    boudreauxFamilyId: family!.id,
    theoJoinRequestPersonId: theo?.id,
    memberInviteToken,
  };
}
