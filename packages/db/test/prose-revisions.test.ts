import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { media, persons, proseRevisions, stories } from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makeStory(): Promise<{ personId: string; storyId: string }> {
  const [p] = await db
    .insert(persons)
    .values({ displayName: "Eleanor", spokenName: "Eleanor" })
    .returning();
  const [rec] = await db
    .insert(media)
    .values({
      ownerPersonId: p!.id,
      kind: "story_audio",
      storageKey: "s3://bucket/o.wav",
      contentType: "audio/wav",
      checksum: "abc",
    })
    .returning();
  const [s] = await db
    .insert(stories)
    .values({ ownerPersonId: p!.id, recordingMediaId: rec!.id })
    .returning();
  return { personId: p!.id, storyId: s!.id };
}

describe("prose_revisions table", () => {
  it("stores a level/text/modelId/promptText/actor row and assigns a monotonic seq", async () => {
    const { personId, storyId } = await makeStory();
    const [l1] = await db
      .insert(proseRevisions)
      .values({
        storyId,
        level: "ai_transcribed",
        text: "raw transcript",
        modelId: "mock-whisper-turbo",
      })
      .returning();
    const [l3] = await db
      .insert(proseRevisions)
      .values({
        storyId,
        level: "human_corrected",
        text: "edited prose",
        actorPersonId: personId,
      })
      .returning();

    expect(l1!.level).toBe("ai_transcribed");
    expect(l1!.text).toBe("raw transcript");
    expect(l1!.modelId).toBe("mock-whisper-turbo");
    expect(l1!.promptText).toBeNull();
    expect(l1!.actorPersonId).toBeNull();
    expect(l3!.level).toBe("human_corrected");
    expect(l3!.text).toBe("edited prose");
    expect(l3!.modelId).toBeNull();
    expect(l3!.actorPersonId).toBe(personId);
    expect(l3!.seq).toBeGreaterThan(l1!.seq);

    const rows = await db
      .select()
      .from(proseRevisions)
      .where(eq(proseRevisions.storyId, storyId));
    expect(rows).toHaveLength(2);
  });

  it("rejects UPDATE of a prose revision", async () => {
    const { storyId } = await makeStory();
    const [row] = await db
      .insert(proseRevisions)
      .values({ storyId, level: "ai_polished", text: "v1", modelId: "mock-claude" })
      .returning();
    await expect(
      db
        .update(proseRevisions)
        .set({ text: "v2" })
        .where(eq(proseRevisions.id, row!.id)),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects DELETE of a prose revision", async () => {
    const { storyId } = await makeStory();
    const [row] = await db
      .insert(proseRevisions)
      .values({ storyId, level: "ai_polished", text: "v1", modelId: "mock-claude" })
      .returning();
    await expect(
      db.delete(proseRevisions).where(eq(proseRevisions.id, row!.id)),
    ).rejects.toThrow(/append-only/i);
  });
});
