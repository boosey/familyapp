import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getStoryForViewer,
  persistRecordingAndCreateDraft,
} from "../src/index";
import { makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("persistRecordingAndCreateDraft (capture write path)", () => {
  it("writes the recording first, then a draft story pointing at it", async () => {
    const elder = await makePerson(db, "Eleanor");
    const { recording, story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: elder.id,
      storageKey: "r2://chronicle/eleanor/rec-1.webm",
      contentType: "audio/webm",
      durationSeconds: 142,
      checksum: "sha256:deadbeef",
    });

    expect(recording.kind).toBe("story_audio");
    expect(recording.ownerPersonId).toBe(elder.id);
    expect(story.recordingMediaId).toBe(recording.id);
    expect(story.ownerPersonId).toBe(elder.id);
    // born private + draft (stays there until voice approval)
    expect(story.state).toBe("draft");
    expect(story.audienceTier).toBe("private");
  });

  it("the elder can immediately read their own fresh draft; a stranger cannot", async () => {
    const elder = await makePerson(db, "Eleanor");
    const stranger = await makePerson(db, "Stranger");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: elder.id,
      storageKey: "r2://chronicle/eleanor/rec-2.webm",
      contentType: "audio/webm",
      checksum: "sha256:cafe",
    });

    const asElder = await getStoryForViewer(
      db,
      { kind: "elder_session", personId: elder.id },
      story.id,
    );
    expect(asElder?.id).toBe(story.id);

    const asStranger = await getStoryForViewer(
      db,
      { kind: "account", personId: stranger.id },
      story.id,
    );
    expect(asStranger).toBeNull();
  });

  it("carries provenance (promptQuestion / askId) onto the draft", async () => {
    const elder = await makePerson(db, "Eleanor");
    const { story } = await persistRecordingAndCreateDraft(
      db,
      {
        ownerPersonId: elder.id,
        storageKey: "r2://chronicle/eleanor/rec-3.webm",
        contentType: "audio/webm",
        checksum: "sha256:f00d",
      },
      { promptQuestion: "What was your mother like?" },
    );
    expect(story.promptQuestion).toBe("What was your mother like?");
  });
});
