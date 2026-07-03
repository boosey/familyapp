/**
 * Regression tests for ADR-0012/ADR-0013 — the story_recordings take ledger and the
 * follow_up_decisions ledger.
 *
 *   - story_recordings orders takes by position and enforces one take per (story, position).
 *   - a take is freely droppable pre-approval, but frozen once its story has a consent record
 *     (trigger `story_recordings_post_consent_immutable`).
 *   - follow_up_decisions is append-only (trigger `follow_up_decisions_append_only`), mirroring
 *     the consent ledger's shape.
 */
import { eq, asc } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { media, stories, storyRecordings } from "../src/content";
import { consentRecords, followUpDecisions, persons } from "../src/schema";
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
      storageKey: `s3://bucket/${crypto.randomUUID()}.wav`,
      contentType: "audio/wav",
      checksum: crypto.randomUUID(),
    })
    .returning();
  const [s] = await db
    .insert(stories)
    .values({ ownerPersonId: p!.id, recordingMediaId: rec!.id })
    .returning();
  return { personId: p!.id, storyId: s!.id };
}

/** Insert a story_audio media row + a story_recordings take pointing at it. */
async function makeTake(storyId: string, ownerPersonId: string, position: number) {
  const [take] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "story_audio",
      storageKey: `s3://bucket/take-${crypto.randomUUID()}.wav`,
      contentType: "audio/wav",
      checksum: crypto.randomUUID(),
    })
    .returning();
  const [rec] = await db
    .insert(storyRecordings)
    .values({ storyId, position, mediaId: take!.id })
    .returning();
  return rec!;
}

describe("story_recordings table", () => {
  it("orders takes by position and rejects a duplicate position for the same story", async () => {
    const { personId, storyId } = await makeStory();
    await makeTake(storyId, personId, 0);
    await makeTake(storyId, personId, 1);

    const rows = await db
      .select()
      .from(storyRecordings)
      .where(eq(storyRecordings.storyId, storyId))
      .orderBy(asc(storyRecordings.position));
    expect(rows.map((r) => r.position)).toEqual([0, 1]);

    await expect(makeTake(storyId, personId, 0)).rejects.toThrow();
  });

  it("permits deleting a take pre-approval, forbids it once the story has a consent record", async () => {
    const { personId, storyId } = await makeStory();
    await makeTake(storyId, personId, 0);
    const followUp = await makeTake(storyId, personId, 1);

    // Pre-approval: dropping a take is allowed.
    await expect(
      db.delete(storyRecordings).where(eq(storyRecordings.id, followUp.id)),
    ).resolves.not.toThrow();

    const readded = await makeTake(storyId, personId, 1);

    // Story is now approved/shared.
    await db.insert(consentRecords).values({
      personId,
      actorPersonId: personId,
      storyId,
      action: "approved_for_sharing",
      resultingState: "shared",
    });

    await expect(
      db.delete(storyRecordings).where(eq(storyRecordings.id, readded.id)),
    ).rejects.toThrow(/immutable after approval/);
  });
});

describe("follow_up_decisions table", () => {
  it("is append-only: rejects UPDATE and DELETE of a decision row", async () => {
    const { storyId } = await makeStory();
    const [row] = await db
      .insert(followUpDecisions)
      .values({
        storyId,
        threadPosition: 0,
        recordKind: "decision",
        evaluatorModelId: "mock-claude",
        candidates: [],
        dispositions: [],
      })
      .returning();

    await expect(
      db
        .update(followUpDecisions)
        .set({ selectedSeed: "changed" })
        .where(eq(followUpDecisions.id, row!.id)),
    ).rejects.toThrow(/append-only/i);

    await expect(
      db.delete(followUpDecisions).where(eq(followUpDecisions.id, row!.id)),
    ).rejects.toThrow(/append-only/i);
  });

  it("enforces the decision_id self-FK: an outcome row can't reference a non-existent decision", async () => {
    const { storyId } = await makeStory();
    await expect(
      db.insert(followUpDecisions).values({
        storyId,
        threadPosition: 0,
        recordKind: "outcome",
        outcome: "answered",
        decisionId: crypto.randomUUID(), // no row with this id exists
      }),
    ).rejects.toThrow();
  });
});
