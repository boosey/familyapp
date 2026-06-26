import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getStoryForViewer,
  listElderMemoryForInterviewer,
  persistRecordingAndCreateDraft,
  updateDerivedFields,
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

describe("listElderMemoryForInterviewer (audited cross-session memory read)", () => {
  it("returns only safe metadata for the elder's own stories — never transcript / prose / audio key", async () => {
    const elder = await makePerson(db, "Eleanor");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: elder.id,
      storageKey: "r2://chronicle/eleanor/rec.webm",
      contentType: "audio/webm",
      checksum: "sha256:1",
    });
    await updateDerivedFields(db, story.id, {
      transcript: "I grew up on a farm.",
      prose: "I grew up on a farm in Iowa.",
      title: "The Iowa farm",
      summary: "A childhood on an Iowa farm.",
      tags: ["childhood", "farm"],
    });
    const rows = await listElderMemoryForInterviewer(db, elder.id, 10);
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    // Permitted: safe metadata.
    expect(row.title).toBe("The Iowa farm");
    expect(row.summary).toBe("A childhood on an Iowa farm.");
    expect(row.tags).toEqual(["childhood", "farm"]);
    // The contract is the projection: forbidden fields are NOT on the row type — confirm by
    // structural absence (Object.keys is the runtime check; the TS type already disallows it).
    const keys = Object.keys(row).sort();
    expect(keys).toEqual(
      ["createdAt", "promptQuestion", "storyId", "summary", "tags", "title"].sort(),
    );
  });

  it("returns most-recent first, capped at the requested limit", async () => {
    const elder = await makePerson(db, "Eleanor");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: elder.id,
        storageKey: `r2://chronicle/eleanor/rec-${i}.webm`,
        contentType: "audio/webm",
        checksum: `sha256:${i}`,
      });
      ids.push(story.id);
      // Force monotonic createdAt ordering across rows.
      await new Promise((r) => setTimeout(r, 5));
    }
    const rows = await listElderMemoryForInterviewer(db, elder.id, 2);
    expect(rows.length).toBe(2);
    // Most recent first => the last-inserted story is first.
    expect(rows[0]!.storyId).toBe(ids[2]);
    expect(rows[1]!.storyId).toBe(ids[1]);
  });

  it("does NOT surface stories owned by another person (scoping by ownerPersonId)", async () => {
    const elder = await makePerson(db, "Eleanor");
    const other = await makePerson(db, "Other");
    await persistRecordingAndCreateDraft(db, {
      ownerPersonId: other.id,
      storageKey: "r2://chronicle/other/rec.webm",
      contentType: "audio/webm",
      checksum: "sha256:other",
    });
    const rows = await listElderMemoryForInterviewer(db, elder.id, 10);
    expect(rows.length).toBe(0);
  });
});
