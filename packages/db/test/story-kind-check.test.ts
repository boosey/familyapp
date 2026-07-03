/**
 * Regression tests for ADR-0007 — the kind ⇔ recording-pointer INSERT invariant, enforced by the
 * DB CHECK `stories_kind_recording_ck` in invariants.sql (drizzle-kit does not model CHECKs).
 *
 * A Story is origin-typed:
 *   - kind = 'voice' MUST carry a canonical recording (recording_media_id IS NOT NULL).
 *   - kind = 'text'  MUST NOT carry one (recording_media_id IS NULL); its typed words are canonical.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { media, persons, stories } from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(displayName = "Eleanor") {
  const [p] = await db
    .insert(persons)
    .values({ displayName, spokenName: displayName })
    .returning();
  return p!;
}

/** Insert a story-audio media row (a candidate canonical recording). */
async function makeRecording(ownerPersonId: string) {
  const [rec] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "story_audio",
      storageKey: `s3://bucket/${crypto.randomUUID()}.wav`,
      contentType: "audio/wav",
      durationSeconds: 60,
      checksum: crypto.randomUUID(),
    })
    .returning();
  return rec!;
}

describe("stories_kind_recording_ck (ADR-0007)", () => {
  it("rejects a 'voice' story with a NULL recording pointer", async () => {
    const narrator = await makePerson();
    await expect(
      db
        .insert(stories)
        .values({ ownerPersonId: narrator.id, kind: "voice", recordingMediaId: null }),
    ).rejects.toThrow(/stories_kind_recording_ck|check/i);
  });

  it("rejects a 'text' story that carries a recording pointer", async () => {
    const narrator = await makePerson();
    const rec = await makeRecording(narrator.id);
    await expect(
      db
        .insert(stories)
        .values({ ownerPersonId: narrator.id, kind: "text", recordingMediaId: rec.id }),
    ).rejects.toThrow(/stories_kind_recording_ck|check/i);
  });

  it("accepts a 'text' story with a NULL recording pointer and typed prose", async () => {
    const narrator = await makePerson();
    const [story] = await db
      .insert(stories)
      .values({
        ownerPersonId: narrator.id,
        kind: "text",
        recordingMediaId: null,
        transcript: "I was born in a small house on Cherry Street.",
      })
      .returning();
    expect(story!.id).toBeTruthy();
    expect(story!.kind).toBe("text");
    expect(story!.recordingMediaId).toBeNull();
  });
});
