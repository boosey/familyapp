/**
 * DEV-ONLY seed logic. Shared between the /dev/seed page server action and the curl-friendly
 * /api/dev/seed POST. Wipes (TRUNCATE) and recreates a small click-through-ready dataset.
 *
 * Identity:
 *   - Persons: Eleanor (elder, no Account), Sofia + Marco (members, with Accounts)
 *   - Family: Boudreaux, with all three active members
 *
 * Sample content (every write goes through the audited core path; storage-first ordering):
 *   - One Story already approved+shared at family tier (visible in /hub when signed in as Sofia/Marco)
 *   - One Story left at pending_approval (drives the /s/<token>/approve/<storyId> UI)
 *   - One elder session for Eleanor (returned token; the raw token IS the elder's identity)
 *
 * TRUNCATE bypasses the BEFORE UPDATE/DELETE triggers on consent_records/media, so re-running
 * this seed cleanly resets the dataset without fighting the immutability invariants.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  accounts,
  families,
  memberships,
  persons,
} from "@chronicle/db/schema";
import {
  approveAndShareStory,
  createInvitation,
  createJoinRequest,
  persistRecordingAndCreateDraft,
  transitionStoryState,
  updateDerivedFields,
} from "@chronicle/core";
import { createElderSession } from "@chronicle/capture";
import { getRuntime } from "./runtime";
import { seedMockCredential } from "./auth-mock";

/** Shared dev password handed to every seeded younger-gen credential. */
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
  elderToken: string;
  elderPersonId: string;
  pendingStoryId: string;
  /** A seeded younger-gen account you can sign in as through the real mock flow (the steward). */
  stewardSignInEmail: string;
  /** The shared password for every seeded credential (Sofia, Marco, Theo). */
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
 * Create → derive → approve+share a story for an elder, then back-date its timeline so the hub's
 * Era facet spans real decades. Dates are stamped via a raw SQL UPDATE — the documented dev-only
 * bypass; production never backdates a story.
 */
async function seedApprovedStory(
  db: Awaited<ReturnType<typeof getRuntime>>["db"],
  storage: Awaited<ReturnType<typeof getRuntime>>["storage"],
  elderPersonId: string,
  spec: ExtraStorySpec,
): Promise<void> {
  const audio = tinyWav();
  const key = `story-audio/${elderPersonId}/${randomUUID()}.wav`;
  await storage.put({ key, bytes: audio, contentType: SAMPLE_AUDIO_CONTENT_TYPE });
  const { story } = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId: elderPersonId,
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
  const approvalKey = `approval-audio/${elderPersonId}/${randomUUID()}.wav`;
  await storage.put({
    key: approvalKey,
    bytes: approvalAudio,
    contentType: SAMPLE_AUDIO_CONTENT_TYPE,
  });
  await approveAndShareStory(db, {
    storyId: story.id,
    elderPersonId,
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

  // mock_auth_users has no FK back to persons/accounts, so a CASCADE off those tables does NOT
  // clear it — list it explicitly or a re-seed trips the unique-email index. invitations and
  // join_requests would cascade via their family/person FKs, but we name them too for clarity.
  await db.execute(sql`
    TRUNCATE TABLE
      asks,
      consent_records,
      stories,
      media,
      elder_sessions,
      invitations,
      join_requests,
      memberships,
      families,
      persons,
      accounts,
      mock_auth_users
    RESTART IDENTITY CASCADE
  `);

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

  // --- Onboarding + family-flow demo data --------------------------------------------------
  // Give Sofia + Marco real login credentials (the mock provider plays Clerk locally) so the
  // /sign-in flow works, and mark them already-onboarded (onboarded_at + birth_date set) so they
  // land straight on the hub instead of the /welcome onboarding gate.
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

  const { token } = await createElderSession(db, {
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
    elderPersonId: eleanor!.id,
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

  // Story 2 — left at pending_approval so the approval UI has something to act on.
  const pendingAudio = tinyWav();
  const pendingKey = `story-audio/${eleanor!.id}/${randomUUID()}.wav`;
  await storage.put({
    key: pendingKey,
    bytes: pendingAudio,
    contentType: SAMPLE_AUDIO_CONTENT_TYPE,
  });
  const { story: pendingStory } = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId: eleanor!.id,
      storageKey: pendingKey,
      contentType: SAMPLE_AUDIO_CONTENT_TYPE,
      durationSeconds: 1,
      checksum: checksumOf(pendingAudio),
    },
    { promptQuestion: "What did your father do for a living?" },
  );
  await updateDerivedFields(db, pendingStory.id, {
    transcript:
      "My father worked on the railroad — the Southern Pacific. He was gone for days at a time " +
      "and when he came home he smelled like creosote and metal.",
    prose:
      "My father worked on the Southern Pacific railroad. He was gone for days at a time; " +
      "when he came home, the smell of creosote and metal came with him.",
    title: "My father on the railroad",
    summary: "Eleanor remembers her father's railroad work.",
    tags: ["father", "work"],
    eraYear: 1948,
    eraLabel: "the railroad",
  });
  await transitionStoryState(db, pendingStory.id, "pending_approval");

  return {
    elderToken: token,
    elderPersonId: eleanor!.id,
    pendingStoryId: pendingStory.id,
    stewardSignInEmail: "sofia@example.test",
    seedPassword: SEED_PASSWORD,
    boudreauxFamilyId: family!.id,
    theoJoinRequestPersonId: theo!.id,
    memberInviteToken,
  };
}
