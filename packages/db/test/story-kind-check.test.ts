/**
 * ADR-0014 §3 — the kind ⇔ recording invariant for MIXED drafts.
 *   - single-table CHECK: NOT (kind='text' AND recording_media_id IS NOT NULL)
 *   - deferred constraint trigger: (kind='voice') ⟺ (≥1 story_recordings row), checked at COMMIT.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { media, persons, stories, storyRecordings } from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(displayName = "Eleanor") {
  const [p] = await db.insert(persons).values({ displayName, spokenName: displayName }).returning();
  return p!;
}
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
function eqId(id: string) {
  return eq(stories.id, id);
}

describe("single-table CHECK: text ⇒ no recording pointer", () => {
  it("rejects a 'text' story that carries a recording pointer", async () => {
    const narrator = await makePerson();
    const rec = await makeRecording(narrator.id);
    await expect(
      db.insert(stories).values({ ownerPersonId: narrator.id, kind: "text", recordingMediaId: rec.id }),
    ).rejects.toThrow(/check|text.*recording|recording.*text/i);
  });

  it("accepts a 'text' story with a NULL pointer and no take", async () => {
    const narrator = await makePerson();
    const [story] = await db
      .insert(stories)
      .values({
        ownerPersonId: narrator.id,
        kind: "text",
        recordingMediaId: null,
        transcript: "I was born on Cherry Street.",
      })
      .returning();
    expect(story!.kind).toBe("text");
  });
});

describe("deferred biconditional: voice ⟺ ≥1 story_recordings row", () => {
  it("rejects a lone voice story with no take (fails at commit)", async () => {
    const narrator = await makePerson();
    const rec = await makeRecording(narrator.id);
    // Bare insert = its own autocommit tx; the deferred trigger fires at that commit.
    await expect(
      db.insert(stories).values({ ownerPersonId: narrator.id, kind: "voice", recordingMediaId: rec.id }),
    ).rejects.toThrow(/kind|recording|invariant|restrict/i);
  });

  it("accepts a voice story + take-0 created in ONE transaction", async () => {
    const narrator = await makePerson();
    const rec = await makeRecording(narrator.id);
    const story = await db.transaction(async (tx) => {
      const [s] = await tx
        .insert(stories)
        .values({ ownerPersonId: narrator.id, kind: "voice", recordingMediaId: rec.id })
        .returning();
      await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: rec.id });
      return s!;
    });
    expect(story.kind).toBe("voice");
  });

  it("rejects a text story that gets a stray take (text ⟺ no takes)", async () => {
    const narrator = await makePerson();
    const rec = await makeRecording(narrator.id);
    const [textStory] = await db
      .insert(stories)
      .values({ ownerPersonId: narrator.id, kind: "text", recordingMediaId: null })
      .returning();
    // A take on a text story violates the biconditional at commit of THIS bare insert.
    await expect(
      db.insert(storyRecordings).values({ storyId: textStory!.id, position: 0, mediaId: rec.id }),
    ).rejects.toThrow(/kind|recording|invariant|restrict/i);
  });

  it("permits flipping text→voice + inserting the first take in ONE tx", async () => {
    const narrator = await makePerson();
    const rec = await makeRecording(narrator.id);
    const [textStory] = await db
      .insert(stories)
      .values({ ownerPersonId: narrator.id, kind: "text", recordingMediaId: null })
      .returning();
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(storyRecordings).values({ storyId: textStory!.id, position: 0, mediaId: rec.id });
        await tx.update(stories).set({ kind: "voice" }).where(eqId(textStory!.id));
      }),
    ).resolves.not.toThrow();
  });
});
