/**
 * Tests for listOutstandingDrafts — the general (ask-backed AND self-initiated) view of a person's
 * `pending_approval` drafts. The Stories tab resumes self-initiated (askId=null) tellings from here;
 * the ask-only `listOutstandingAnswerDrafts` wrapper (see outstanding-answers.test.ts) is unchanged.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import { createTextDraft, listOutstandingDrafts, transitionStoryState } from "../src/index";
import { makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("listOutstandingDrafts", () => {
  it("returns self-initiated (askId=null) pending_approval drafts, with kind", async () => {
    const owner = await makePerson(db, "Eleanor");
    const { story } = await createTextDraft(db, {
      ownerPersonId: owner.id,
      text: "I grew up in Louisiana, surrounded by bayous.",
    });
    await transitionStoryState(db, story.id, "pending_approval");

    const drafts = await listOutstandingDrafts(db, owner.id);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.storyId).toBe(story.id);
    expect(drafts[0]!.askId).toBeNull();
    expect(drafts[0]!.kind).toBe("text");
  });

  it("excludes drafts still in 'draft' state", async () => {
    const owner = await makePerson(db, "Eleanor");
    await createTextDraft(db, {
      ownerPersonId: owner.id,
      text: "An unfinished telling.",
    });

    const drafts = await listOutstandingDrafts(db, owner.id);
    expect(drafts).toHaveLength(0);
  });
});
