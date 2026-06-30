/**
 * Regression tests for listOutstandingAnswerDrafts — the in-hub review-phase discovery function.
 *
 * After the prose-provenance reorder, render runs at record time, so a successfully-recorded
 * answer sits in `pending_approval` (not `draft`). These tests confirm the finder returns
 * `pending_approval` ask-linked stories and excludes both `draft` (incomplete pipeline) and
 * post-approval stories.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  approveAndShareStory,
  createAsk,
  listOutstandingAnswerDrafts,
  persistRecordingAndCreateDraft,
  transitionStoryState,
  updateDerivedFields,
} from "../src/index";
import { addMembership, makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/**
 * Seed a narrator and a family Ask aimed at them (requires a co-member asker).
 * Returns the narrator and the ask.
 */
async function makeNarratorAndAsk(db: Database) {
  const narrator = await makePerson(db, "Eleanor");
  const asker = await makePerson(db, "Sofia");
  const fam = await makeFamily(db, "Boudreaux", narrator.id);
  await addMembership(db, narrator.id, fam.id);
  await addMembership(db, asker.id, fam.id);
  const ask = await createAsk(
    db,
    { kind: "account", personId: asker.id },
    {
      targetPersonId: narrator.id,
      familyId: fam.id,
      questionText: "What was your childhood like?",
    },
  );
  return { narrator, ask };
}

/**
 * Advance a draft story to pending_approval with prose — mirrors what runRenderStoryStage leaves.
 */
async function advanceToPendingApproval(db: Database, storyId: string) {
  await updateDerivedFields(db, storyId, {
    transcript: "I grew up in Louisiana.",
    prose: "I grew up in Louisiana, surrounded by bayous.",
    title: "Louisiana",
    summary: "Growing up in Louisiana.",
    tags: ["childhood"],
  });
  await transitionStoryState(db, storyId, "pending_approval");
}

describe("listOutstandingAnswerDrafts", () => {
  it("returns a pending_approval answer story (the in-hub review screen is reachable)", async () => {
    const { narrator, ask } = await makeNarratorAndAsk(db);

    const { story } = await persistRecordingAndCreateDraft(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: `r2://chronicle/rec-${Math.random()}.webm`,
        contentType: "audio/webm",
        durationSeconds: 60,
        checksum: `sha256:${Math.random()}`,
      },
      { askId: ask.id },
    );
    await advanceToPendingApproval(db, story.id);

    const results = await listOutstandingAnswerDrafts(db, narrator.id);
    expect(results).toHaveLength(1);
    expect(results[0]!.askId).toBe(ask.id);
    expect(results[0]!.storyId).toBe(story.id);
  });

  it("does NOT return a story still in draft (incomplete pipeline — not ready to review)", async () => {
    const { narrator, ask } = await makeNarratorAndAsk(db);

    // Persist the draft but do NOT advance to pending_approval — pipeline didn't complete.
    await persistRecordingAndCreateDraft(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: `r2://chronicle/rec-${Math.random()}.webm`,
        contentType: "audio/webm",
        checksum: `sha256:${Math.random()}`,
      },
      { askId: ask.id },
    );

    const results = await listOutstandingAnswerDrafts(db, narrator.id);
    expect(results).toHaveLength(0);
  });

  it("does NOT return an already-shared story (narrator already approved it — no longer outstanding)", async () => {
    const { narrator, ask } = await makeNarratorAndAsk(db);

    const { story } = await persistRecordingAndCreateDraft(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: `r2://chronicle/rec-${Math.random()}.webm`,
        contentType: "audio/webm",
        checksum: `sha256:${Math.random()}`,
      },
      { askId: ask.id },
    );
    await advanceToPendingApproval(db, story.id);
    // Narrator approves → transitions OUT of pending_approval to shared.
    await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: narrator.id,
      audienceTier: "family",
    });

    const results = await listOutstandingAnswerDrafts(db, narrator.id);
    expect(results).toHaveLength(0);
  });

  it("returns the most recent pending_approval story per ask when multiple exist", async () => {
    const { narrator, ask } = await makeNarratorAndAsk(db);

    // First take — will be superseded.
    const { story: first } = await persistRecordingAndCreateDraft(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: `r2://chronicle/rec-first-${Math.random()}.webm`,
        contentType: "audio/webm",
        checksum: `sha256:first`,
      },
      { askId: ask.id },
    );
    await advanceToPendingApproval(db, first.id);
    // Tiny delay so createdAt ordering is deterministic.
    await new Promise((r) => setTimeout(r, 5));

    // Second take — this is the one we expect back.
    const { story: second } = await persistRecordingAndCreateDraft(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: `r2://chronicle/rec-second-${Math.random()}.webm`,
        contentType: "audio/webm",
        checksum: `sha256:second`,
      },
      { askId: ask.id },
    );
    await advanceToPendingApproval(db, second.id);

    const results = await listOutstandingAnswerDrafts(db, narrator.id);
    // Dedup by ask — only the latest take surfaces.
    expect(results).toHaveLength(1);
    expect(results[0]!.storyId).toBe(second.id);
  });
});
