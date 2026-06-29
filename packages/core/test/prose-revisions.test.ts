import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendProseRevision,
  listProseRevisions,
  persistRecordingAndCreateDraft,
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
