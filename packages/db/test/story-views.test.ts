/**
 * story_views — per-viewer read state backing the hub's "New" badge.
 *
 * Guarantees:
 *   - a viewer's first open records exactly one row;
 *   - re-opening the same story is idempotent (the (story_id, person_id) unique index makes the
 *     insert a no-op via onConflictDoNothing) — a story never "un-news" twice;
 *   - distinct viewers and distinct stories each get their own row.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { media, persons, stories, storyViews } from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makePerson(displayName: string) {
  const [p] = await db
    .insert(persons)
    .values({ displayName, spokenName: displayName })
    .returning();
  return p!;
}

async function makeStory(ownerPersonId: string) {
  const [rec] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "story_audio",
      storageKey: "s3://bucket/original.wav",
      contentType: "audio/wav",
      checksum: "abc123",
    })
    .returning();
  const [story] = await db
    .insert(stories)
    .values({ ownerPersonId, recordingMediaId: rec!.id })
    .returning();
  return story!;
}

function recordView(storyId: string, personId: string) {
  return db
    .insert(storyViews)
    .values({ storyId, personId })
    .onConflictDoNothing({ target: [storyViews.storyId, storyViews.personId] });
}

async function viewCount(storyId: string, personId: string) {
  const rows = await db
    .select()
    .from(storyViews)
    .where(and(eq(storyViews.storyId, storyId), eq(storyViews.personId, personId)));
  return rows.length;
}

describe("story_views read-state", () => {
  it("records one row the first time a viewer opens a story", async () => {
    const narrator = await makePerson("Eleanor");
    const viewer = await makePerson("Rosa");
    const story = await makeStory(narrator.id);

    await recordView(story.id, viewer.id);

    expect(await viewCount(story.id, viewer.id)).toBe(1);
  });

  it("is idempotent — re-opening the same story does not add a second row", async () => {
    const narrator = await makePerson("Eleanor");
    const viewer = await makePerson("Rosa");
    const story = await makeStory(narrator.id);

    await recordView(story.id, viewer.id);
    await recordView(story.id, viewer.id);
    await recordView(story.id, viewer.id);

    expect(await viewCount(story.id, viewer.id)).toBe(1);
  });

  it("tracks each (viewer, story) independently", async () => {
    const narrator = await makePerson("Eleanor");
    const rosa = await makePerson("Rosa");
    const sal = await makePerson("Salvatore");
    const storyA = await makeStory(narrator.id);
    const storyB = await makeStory(narrator.id);

    await recordView(storyA.id, rosa.id);
    await recordView(storyB.id, rosa.id);
    await recordView(storyA.id, sal.id);

    // Rosa has seen both; Sal has seen only A.
    const rosaSeen = await db
      .select({ storyId: storyViews.storyId })
      .from(storyViews)
      .where(eq(storyViews.personId, rosa.id));
    const salSeen = await db
      .select({ storyId: storyViews.storyId })
      .from(storyViews)
      .where(eq(storyViews.personId, sal.id));

    expect(new Set(rosaSeen.map((r) => r.storyId))).toEqual(new Set([storyA.id, storyB.id]));
    expect(salSeen.map((r) => r.storyId)).toEqual([storyA.id]);
  });
});
