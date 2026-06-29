import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendProseRevision,
  listProseRevisions,
  persistRecordingAndCreateDraft,
  saveProseCorrection,
  transitionStoryState,
  updateDerivedFields,
} from "../src/index";
import { makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function seedStory(): Promise<{ personId: string; storyId: string }> {
  const narrator = await makePerson(db, "Eleanor");
  const { story } = await persistRecordingAndCreateDraft(db, {
    ownerPersonId: narrator.id,
    storageKey: "r2://x.webm",
    contentType: "audio/webm",
    checksum: "sha256:x",
  });
  return { personId: narrator.id, storyId: story.id };
}

describe("saveProseCorrection", () => {
  async function seedPendingApproval() {
    const { personId, storyId } = await seedStory();
    await updateDerivedFields(db, storyId, { transcript: "t", prose: "polished L2" });
    await transitionStoryState(db, storyId, "pending_approval");
    return { personId, storyId };
  }

  it("sets stories.prose to the correction and appends a human_corrected revision", async () => {
    const { personId, storyId } = await seedPendingApproval();
    const story = await saveProseCorrection(db, {
      storyId,
      correctedProse: "human edited L3",
      actorPersonId: personId,
    });
    expect(story.prose).toBe("human edited L3");

    const rows = await listProseRevisions(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe("human_corrected");
    expect(rows[0]!.text).toBe("human edited L3");
    expect(rows[0]!.actorPersonId).toBe(personId);
  });

  it("rejects a non-owner", async () => {
    const { storyId } = await seedPendingApproval();
    const stranger = await makePerson(db, "Stranger");
    await expect(
      saveProseCorrection(db, {
        storyId,
        correctedProse: "x",
        actorPersonId: stranger.id,
      }),
    ).rejects.toThrow(/not the owner/i);
  });

  it("rejects a story that is not pending_approval", async () => {
    const { personId, storyId } = await seedStory(); // still draft
    await expect(
      saveProseCorrection(db, {
        storyId,
        correctedProse: "x",
        actorPersonId: personId,
      }),
    ).rejects.toThrow(/pending_approval/i);
  });
});

describe("appendProseRevision / listProseRevisions", () => {
  it("appends rows and lists them in seq order", async () => {
    const { personId, storyId } = await seedStory();
    await appendProseRevision(db, {
      storyId,
      level: "ai_transcribed",
      text: "raw",
      modelId: "mock-whisper-turbo",
    });
    await appendProseRevision(db, {
      storyId,
      level: "ai_polished",
      text: "polished",
      modelId: "mock-claude",
      promptText: "SYSTEM PROMPT",
    });
    await appendProseRevision(db, {
      storyId,
      level: "human_corrected",
      text: "edited",
      actorPersonId: personId,
    });

    const rows = await listProseRevisions(db, storyId);
    expect(rows.map((r) => r.level)).toEqual([
      "ai_transcribed",
      "ai_polished",
      "human_corrected",
    ]);
    expect(rows[1]!.promptText).toBe("SYSTEM PROMPT");
    expect(rows[2]!.actorPersonId).toBe(personId);
  });
});
