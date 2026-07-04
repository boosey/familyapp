import { createTestDatabase, type Database } from "@chronicle/db";
import { media, stories, storyRecordings } from "@chronicle/db/content";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTextDraft, InvariantViolation, listProseRevisions } from "../src/index";
import { makePerson } from "./helpers";

describe("createTextDraft (ADR-0007 text origin)", () => {
  let db: Database;
  beforeEach(async () => {
    db = await createTestDatabase();
  });

  it("creates a BARE kind='text' draft — no words persisted (the caller appends them)", async () => {
    const owner = await makePerson(db, "Eleanor");

    const { story } = await createTextDraft(db, {
      ownerPersonId: owner.id,
      text: "The summer we moved to Naples.",
    });

    expect(story.kind).toBe("text");
    expect(story.recordingMediaId).toBeNull();
    expect(story.state).toBe("draft");
    expect(story.audienceTier).toBe("private");
    // ADR-0014 Inc 3: createTextDraft no longer persists the typed words. The words are written
    // later by appendTypedTakeContribution (the single writer of the typed take), not here.
    expect(story.transcript).toBeNull();
    expect(story.prose).toBeNull();

    const revs = await listProseRevisions(db, story.id);
    expect(revs).toHaveLength(0);
  });

  it("rejects empty/whitespace text", async () => {
    const owner = await makePerson(db, "Eleanor");
    await expect(
      createTextDraft(db, { ownerPersonId: owner.id, text: "   " }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("does NOT create a media/recording row for a text story", async () => {
    const owner = await makePerson(db, "Eleanor");
    const { story } = await createTextDraft(db, {
      ownerPersonId: owner.id,
      text: "hi",
    });
    const rows = await db.select().from(stories).where(eq(stories.id, story.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recordingMediaId).toBeNull();

    // No media row and no take-set row exist for a text story.
    const mediaRows = await db
      .select()
      .from(media)
      .where(eq(media.ownerPersonId, owner.id));
    expect(mediaRows).toHaveLength(0);
    const takeRows = await db
      .select()
      .from(storyRecordings)
      .where(eq(storyRecordings.storyId, story.id));
    expect(takeRows).toHaveLength(0);
  });
});
