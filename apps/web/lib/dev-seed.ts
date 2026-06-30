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
 *   - One `pending_approval` Story linked to the first Ask (with AI-polished prose) — hub shows "Review & approve" immediately for that ask
 *   - One link session for Eleanor (convenience deep-link / magic-link test; NOT the primary UI entry)
 *
 * Sign-in is the headline entry point: /dev/sign-in (one-click) or /sign-in with credentials.
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
import { seedMockCredential } from "./auth-mock";

/** Shared dev password handed to every seeded account credential. */
const SEED_PASSWORD = "password";

const SAMPLE_AUDIO_CONTENT_TYPE = "audio/wav";

/** A 1-second mono 8 kHz 16-bit PCM WAV of silence. Smallest valid playable thing. */
function tinyWav(): Uint8Array {
  const sampleRate = 8000;
  const numSamples = sampleRate;
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const writeAscii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeAscii(36, "data");
  v.setUint32(40, dataSize, true);
  return new Uint8Array(buf);
}

function checksumOf(bytes: Uint8Array): string {
  return `seed:${bytes.byteLength}:${randomUUID()}`;
}

export interface SeedResult {
  /** Eleanor's link-session token. Usable via /s/<token> for magic-link tests;
   *  NOT presented as the primary entry on the seed page — sign-in is the headline path. */
  narratorToken: string;
  narratorPersonId: string;
  /** Eleanor's one seeded ask-linked story in `pending_approval` with AI-polished prose.
   *  The hub's Questions tab shows "Review & approve" immediately for the linked Ask when signed in
   *  as Eleanor. Named `draftStoryId` for historical continuity; the story is no longer in draft. */
  draftStoryId: string;
  /** A seeded account you can sign in as through the real mock flow (the steward). */
  stewardSignInEmail: string;
  /** The shared password for every seeded credential (Eleanor, Sofia, Marco, Theo). */
  seedPassword: string;
  /** The discoverable Boudreaux family — drives family-search + the steward requests surface. */
  boudreauxFamilyId: string;
  /** The non-member who has a PENDING join request to Boudreaux awaiting Sofia's approval. */
  theoJoinRequestPersonId?: string;
  /** Raw token for a PENDING member invitation to Boudreaux — feeds a working /join/<token> link. */
  memberInviteToken: string;
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
 */
export async function seedInto(
  db: Awaited<ReturnType<typeof getRuntime>>["db"],
  storage: Awaited<ReturnType<typeof getRuntime>>["storage"],
): Promise<SeedResult> {
  // Single-schema dev model: blow the whole DB away and re-apply the CURRENT schema, rather than
  // TRUNCATE-ing a fixed table list. This means a schema change (edit src/schema.ts → regenerate)
  // lands on the very next reseed with no migration bookkeeping and no stale-state archaeology.
  await resetSchema(db);

  const [eleanor] = await db
    .insert(persons)
    .values({
      displayName: "Eleanor Boudreaux",
      spokenName: "Eleanor",
      birthYear: 1942,
      biographicalAnchors: { hometown: "Lafayette, Louisiana" },
    })
    .returning();
  const [sofia] = await db
    .insert(persons)
    .values({
      displayName: "Sofia Boudreaux",
      spokenName: "Sofia",
      birthYear: 1988,
    })
    .returning();
  const [marco] = await db
    .insert(persons)
    .values({
      displayName: "Marco Boudreaux",
      spokenName: "Marco",
      birthYear: 1985,
    })
    .returning();

  const [eleanorAcct] = await db
    .insert(accounts)
    .values({
      authProviderUserId: "dev:eleanor",
      email: "eleanor@example.test",
      displayName: "Eleanor Boudreaux",
    })
    .returning();
  const [sofiaAcct] = await db
    .insert(accounts)
    .values({
      authProviderUserId: "dev:sofia",
      email: "sofia@example.test",
      displayName: "Sofia Boudreaux",
    })
    .returning();
  const [marcoAcct] = await db
    .insert(accounts)
    .values({
      authProviderUserId: "dev:marco",
      email: "marco@example.test",
      displayName: "Marco Boudreaux",
    })
    .returning();
  await db
    .update(persons)
    .set({ accountId: eleanorAcct!.id })
    .where(eq(persons.id, eleanor!.id));
  await db
    .update(persons)
    .set({ accountId: sofiaAcct!.id })
    .where(eq(persons.id, sofia!.id));
  await db
    .update(persons)
    .set({ accountId: marcoAcct!.id })
    .where(eq(persons.id, marco!.id));

  const [family] = await db
    .insert(families)
    .values({
      name: "Boudreaux",
      creatorPersonId: sofia!.id,
      stewardPersonId: sofia!.id,
    })
    .returning();
  await db.insert(memberships).values([
    {
      personId: eleanor!.id,
      familyId: family!.id,
      role: "narrator",
      status: "active",
    },
    {
      personId: sofia!.id,
      familyId: family!.id,
      role: "member",
      status: "active",
    },
    {
      personId: marco!.id,
      familyId: family!.id,
      role: "steward",
      status: "active",
    },
  ]);

  // Four pending Asks for Eleanor so her "Questions for you" tab has a real queue.
  // The FIRST ask is the one the seeded pending_approval story answers (askId=ask1.id).
  const ask1 = await createAsk(
    db,
    { kind: "account", personId: sofia!.id },
    {
      targetPersonId: eleanor!.id,
      familyId: family!.id,
      questionText: "Grandma, what's your earliest memory of your own grandmother?",
    },
  );
  await createAsk(
    db,
    { kind: "account", personId: sofia!.id },
    {
      targetPersonId: eleanor!.id,
      familyId: family!.id,
      questionText:
        "What's the best meal you remember from your childhood? Can you describe it?",
    },
  );
  await createAsk(
    db,
    { kind: "account", personId: marco!.id },
    {
      targetPersonId: eleanor!.id,
      familyId: family!.id,
      questionText:
        "Tell me about a time you felt really proud of one of your children.",
    },
  );
  await createAsk(
    db,
    { kind: "account", personId: marco!.id },
    {
      targetPersonId: eleanor!.id,
      familyId: family!.id,
      questionText:
        "What do you wish you'd known when you were twenty years old?",
    },
  );

  // One ask-linked story for Eleanor in `pending_approval` with AI-polished prose — the render
  // pipeline now runs at record time (not approval), so a recorded answer lands here ready for the
  // narrator to read/edit on the Questions-tab "Review & approve" screen.
  const draftAudio = tinyWav();
  const draftKey = `story-audio/${eleanor!.id}/${randomUUID()}.wav`;
  await storage.put({
    key: draftKey,
    bytes: draftAudio,
    contentType: SAMPLE_AUDIO_CONTENT_TYPE,
  });
  const { story: draftStory } = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId: eleanor!.id,
      storageKey: draftKey,
      contentType: SAMPLE_AUDIO_CONTENT_TYPE,
      durationSeconds: 1,
      checksum: checksumOf(draftAudio),
    },
    { promptQuestion: ask1.questionText, askId: ask1.id },
  );
  // Simulate the render pipeline: L1 (transcribed) → L2 (AI-polished) → pending_approval.
  const askAnswerTranscript =
    "Oh, my grandmother. Her name was Odette and she lived down by the bayou. " +
    "She used to say she could tell the weather by the way the Spanish moss moved. " +
    "I must have been four or five the first time she let me help her shell butter beans on the porch. " +
    "I can still smell that afternoon.";
  const askAnswerProse =
    "Her name was Odette, and she lived down by the bayou. She used to say she could tell the weather " +
    "by the way the Spanish moss moved — and I believed her. My earliest memory of her is sitting on " +
    "her porch, four or five years old, helping shell butter beans in the afternoon heat. I can still " +
    "smell that afternoon.";
  await appendProseRevision(db, {
    storyId: draftStory.id,
    level: "ai_transcribed",
    text: askAnswerTranscript,
    modelId: "mock-whisper-turbo",
  });
  await appendProseRevision(db, {
    storyId: draftStory.id,
    level: "ai_polished",
    text: askAnswerProse,
    modelId: "mock-claude",
    promptText: "[dev-seed] representative render system prompt",
  });
  await updateDerivedFields(db, draftStory.id, {
    transcript: askAnswerTranscript,
    prose: askAnswerProse,
    title: "My grandmother Odette",
    summary: "Eleanor's earliest memory of her grandmother shelling butter beans on the bayou porch.",
    tags: ["grandparents", "childhood", "louisiana"],
    eraYear: 1947,
    eraLabel: "the bayou",
  });
  await transitionStoryState(db, draftStory.id, "pending_approval");

  // --- Onboarding + family-flow demo data --------------------------------------------------
  // Give Eleanor + Sofia + Marco real login credentials (the mock provider plays Clerk locally) so
  // the /sign-in flow works, and mark them already-onboarded (onboarded_at + birth_date set) so they
  // land straight on the hub instead of the /welcome onboarding gate. Every Person has an Account —
  // "narrator" is a role, not an account distinction; Eleanor's link token is a convenience login,
  // not her identity.
  await seedMockCredential(db, {
    email: "eleanor@example.test",
    password: SEED_PASSWORD,
    authProviderUserId: "dev:eleanor",
  });
  await seedMockCredential(db, {
    email: "sofia@example.test",
    password: SEED_PASSWORD,
    authProviderUserId: "dev:sofia",
  });
  await seedMockCredential(db, {
    email: "marco@example.test",
    password: SEED_PASSWORD,
    authProviderUserId: "dev:marco",
  });
  await db
    .update(persons)
    .set({ onboardedAt: sql`now()`, birthDate: "1942-05-10" })
    .where(eq(persons.id, eleanor!.id));
  await db
    .update(persons)
    .set({ onboardedAt: sql`now()`, birthDate: "1988-03-12" })
    .where(eq(persons.id, sofia!.id));
  await db
    .update(persons)
    .set({ onboardedAt: sql`now()`, birthDate: "1985-07-22" })
    .where(eq(persons.id, marco!.id));

  // Make Boudreaux discoverable with a blurb so the family-search demo returns a real hit.
  await db
    .update(families)
    .set({
      discoverable: true,
      description:
        "The Boudreaux family of Lafayette, Louisiana — teachers, railroad workers, and " +
        "storytellers since the 1940s.",
    })
    .where(eq(families.id, family!.id));

  // A non-member (Theo) with a PENDING join request, so Sofia (the steward) has one to approve.
  const [theo] = await db
    .insert(persons)
    .values({ displayName: "Theo Marchetti", spokenName: "Theo" })
    .returning();
  const [theoAcct] = await db
    .insert(accounts)
    .values({
      authProviderUserId: "dev:theo",
      email: "theo@example.test",
      displayName: "Theo Marchetti",
    })
    .returning();
  await db
    .update(persons)
    .set({ accountId: theoAcct!.id })
    .where(eq(persons.id, theo!.id));
  await seedMockCredential(db, {
    email: "theo@example.test",
    password: SEED_PASSWORD,
    authProviderUserId: "dev:theo",
  });
  await createJoinRequest(db, {
    familyId: family!.id,
    requesterPersonId: theo!.id,
    message:
      "Hi Sofia — I'm your cousin Theo from the Marchetti side, hoping to follow Eleanor's stories.",
  });

  // A PENDING member invitation to someone not yet in the system — its raw token feeds a working
  // /join/<token> welcome link. Sofia (an active member) is the inviter.
  const { token: memberInviteToken } = await createInvitation(db, {
    familyId: family!.id,
    inviterPersonId: sofia!.id,
    inviteeName: "Maya Boudreaux",
    inviteeEmail: "maya@example.test",
    relationshipLabel: "Sofia's cousin",
  });

  const { token } = await createLinkSession(db, {
    personId: eleanor!.id,
    familyId: family!.id,
    invitedByPersonId: sofia!.id,
  });

  // Story 1 — approved+shared at family tier (visible on the hub).
  const storyAudio = tinyWav();
  const storyKey = `story-audio/${eleanor!.id}/${randomUUID()}.wav`;
  await storage.put({
    key: storyKey,
    bytes: storyAudio,
    contentType: SAMPLE_AUDIO_CONTENT_TYPE,
  });
  const { story } = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId: eleanor!.id,
      storageKey: storyKey,
      contentType: SAMPLE_AUDIO_CONTENT_TYPE,
      durationSeconds: 1,
      checksum: checksumOf(storyAudio),
    },
    { promptQuestion: "Tell me about the house you grew up in." },
  );
  await updateDerivedFields(db, story.id, {
    transcript:
      "The house on Cherry Street had a wide front porch where my mother kept her ferns. " +
      "In the summer the cicadas would start up at dusk and you could hear them from the kitchen.",
    prose:
      "The house on Cherry Street had a wide front porch where my mother kept her ferns. " +
      "In summer, the cicadas would start up at dusk, loud enough to carry into the kitchen.",
    title: "The porch on Cherry Street",
    summary: "Eleanor remembers her mother's ferns and the cicadas at dusk.",
    tags: ["childhood", "house", "louisiana"],
    eraYear: 1958,
    eraLabel: "Cherry Street",
  });
  await transitionStoryState(db, story.id, "pending_approval");
  const approvalAudio = tinyWav();
  const approvalKey = `approval-audio/${eleanor!.id}/${randomUUID()}.wav`;
  await storage.put({
    key: approvalKey,
    bytes: approvalAudio,
    contentType: SAMPLE_AUDIO_CONTENT_TYPE,
  });
  await approveAndShareStory(db, {
    storyId: story.id,
    narratorPersonId: eleanor!.id,
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
    const iso = new Date("1958-06-15T00:00:00Z").toISOString();
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
      transcript: "We met at a dance hall in 1961. He couldn't dance a step, but he made me laugh.",
      prose:
        "We met at a dance hall in the autumn of 1961. He couldn't dance a single step to save his life, but he made me laugh so hard I forgot to mind my own feet.",
      title: "The dance at the Blue Room",
      summary: "Eleanor remembers the night she met Grandpa — and how badly he danced.",
      tags: ["marriage", "family", "louisiana"],
      occurredAt: new Date("1961-10-12T00:00:00Z"),
      eraYear: 1961,
      eraLabel: "the Blue Room",
    },
    {
      promptQuestion: "What was your wedding day like?",
      transcript: "We married in the spring of 1963. It rained, and everyone said that was good luck.",
      prose:
        "We married on a wet morning in the spring of 1963. It poured the whole way to the church, and every aunt I had told me rain on your wedding day was the best luck a marriage could ask for.",
      title: "Rain on the wedding",
      summary: "A rainy 1963 wedding that the whole family swore was good luck.",
      tags: ["marriage", "family"],
      occurredAt: new Date("1963-04-06T00:00:00Z"),
      eraYear: 1963,
    },
    {
      promptQuestion: "Tell me about the year the children were born.",
      transcript: "Your father was born in 1965, and the house got a lot louder after that.",
      prose:
        "Your father came along in 1965, and that little house on Cherry Street got a great deal louder — and a great deal happier — overnight.",
      title: "The house gets louder",
      summary: "Eleanor on the year her first child was born.",
      tags: ["birth", "family", "house"],
      occurredAt: new Date("1965-07-22T00:00:00Z"),
      eraYear: 1965,
      eraLabel: "Cherry Street",
    },
    {
      promptQuestion: "What work did you do?",
      transcript: "I taught school for thirty years, third grade mostly. I loved the noisy ones.",
      prose:
        "I taught school for thirty years — third grade, mostly. People always pity the teacher with the noisy class, but those were the ones I loved best.",
      title: "Thirty years of third grade",
      summary: "Eleanor's decades teaching — and her soft spot for the loud kids.",
      tags: ["work", "louisiana"],
      occurredAt: new Date("1974-09-03T00:00:00Z"),
      eraYear: 1974,
    },
  ];
  for (const spec of extras) {
    await seedApprovedStory(db, storage, eleanor!.id, spec);
  }

  return {
    narratorToken: token,
    narratorPersonId: eleanor!.id,
    draftStoryId: draftStory.id,
    stewardSignInEmail: "sofia@example.test",
    seedPassword: SEED_PASSWORD,
    boudreauxFamilyId: family!.id,
    theoJoinRequestPersonId: theo!.id,
    memberInviteToken,
  };
}
