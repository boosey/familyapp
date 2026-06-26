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
  persistRecordingAndCreateDraft,
  transitionStoryState,
  updateDerivedFields,
} from "@chronicle/core";
import { createElderSession } from "@chronicle/capture";
import { getRuntime } from "./runtime";

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
}

export async function runSeed(): Promise<SeedResult> {
  const { db, storage } = await getRuntime();

  await db.execute(sql`
    TRUNCATE TABLE
      asks,
      consent_records,
      stories,
      media,
      elder_sessions,
      memberships,
      families,
      persons,
      accounts
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
  });
  await transitionStoryState(db, pendingStory.id, "pending_approval");

  return {
    elderToken: token,
    elderPersonId: eleanor!.id,
    pendingStoryId: pendingStory.id,
  };
}
