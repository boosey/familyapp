import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendStoryRecording,
  createTextDraft,
  discardDraftStory,
  dropStoryRecording,
  listStoryRecordings,
  persistRecordingAndCreateDraft,
  persistTakeRecording,
} from "../src/story-repository";
import { InvariantViolation } from "../src/errors";
import { makePerson } from "./helpers";
import { media, stories } from "@chronicle/db/content";
import { eq } from "drizzle-orm";

let db: Database;

beforeEach(async () => {
  db = await createTestDatabase();
});

async function makeDraft() {
  const narrator = await makePerson(db, "Eleanor");
  const { story, recording } = await persistRecordingAndCreateDraft(db, {
    ownerPersonId: narrator.id,
    storageKey: "r2://chronicle/eleanor/take-0.webm",
    contentType: "audio/webm",
    checksum: "sha256:take0",
  });
  return { narrator, story, recording };
}

describe("story_recordings repo (ordered take set, ADR-0012)", () => {
  it("persistRecordingAndCreateDraft seeds take 0 at position 0", async () => {
    const { story, recording } = await makeDraft();
    const takes = await listStoryRecordings(db, story.id);
    expect(takes).toHaveLength(1);
    expect(takes[0]!.position).toBe(0);
    expect(takes[0]!.mediaId).toBe(recording.id);
  });

  it("persistTakeRecording inserts a new media row AND appends a take at position 1", async () => {
    const { narrator, story } = await makeDraft();
    const { recording, storyRecording } = await persistTakeRecording(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: "r2://chronicle/eleanor/take-1.webm",
        contentType: "audio/webm",
        checksum: "sha256:take1",
      },
      story.id,
    );

    // A brand-new immutable Media row for this take.
    expect(recording.kind).toBe("story_audio");
    expect(recording.storageKey).toBe("r2://chronicle/eleanor/take-1.webm");
    // Appended at the next position after take 0.
    expect(storyRecording.position).toBe(1);
    expect(storyRecording.mediaId).toBe(recording.id);
    expect(storyRecording.storyId).toBe(story.id);

    const takes = await listStoryRecordings(db, story.id);
    expect(takes.map((t) => t.position)).toEqual([0, 1]);
  });

  it("appendStoryRecording appends an already-persisted media at the next position", async () => {
    const { narrator, story } = await makeDraft();
    // Persist a take's media via persistTakeRecording (position 1), then append that same media
    // pointer again through the simpler primitive to prove it advances the position.
    const { recording } = await persistTakeRecording(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: "r2://chronicle/eleanor/take-1.webm",
        contentType: "audio/webm",
        checksum: "sha256:take1",
      },
      story.id,
    );
    const appended = await appendStoryRecording(db, {
      storyId: story.id,
      mediaId: recording.id,
    });
    expect(appended.position).toBe(2);

    const takes = await listStoryRecordings(db, story.id);
    expect(takes.map((t) => t.position)).toEqual([0, 1, 2]);
  });

  it("dropStoryRecording rejects position 0 (the whole-thread discard)", async () => {
    const { narrator, story } = await makeDraft();
    await expect(
      dropStoryRecording(db, {
        storyId: story.id,
        position: 0,
        narratorPersonId: narrator.id,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    // Take 0 is untouched.
    const takes = await listStoryRecordings(db, story.id);
    expect(takes.map((t) => t.position)).toEqual([0]);
  });

  it("dropStoryRecording removes a follow-up take pre-approval and returns its storage key", async () => {
    const { narrator, story } = await makeDraft();
    await persistTakeRecording(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: "r2://chronicle/eleanor/take-1.webm",
        contentType: "audio/webm",
        checksum: "sha256:take1",
      },
      story.id,
    );

    const { storageKey } = await dropStoryRecording(db, {
      storyId: story.id,
      position: 1,
      narratorPersonId: narrator.id,
    });
    expect(storageKey).toBe("r2://chronicle/eleanor/take-1.webm");

    // Only take 0 remains.
    const takes = await listStoryRecordings(db, story.id);
    expect(takes.map((t) => t.position)).toEqual([0]);
  });

  it("discardDraftStory removes the WHOLE take set and returns every blob key (regression: story_recordings FK)", async () => {
    // Regression: seeding take 0 into story_recordings means a story now has a child row referencing
    // it; discardDraftStory must clear the whole ordered take set (not just recording_media_id) or
    // the story delete raises `story_recordings_story_id_stories_id_fk`. It is the whole-thread
    // discard, so it also removes follow-up takes' media and returns their keys (recording first).
    const { narrator, story } = await makeDraft();
    const { recording: take1 } = await persistTakeRecording(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: "r2://chronicle/eleanor/take-1.webm",
        contentType: "audio/webm",
        checksum: "sha256:take1",
      },
      story.id,
    );

    const { storageKeys } = await discardDraftStory(db, {
      storyId: story.id,
      narratorPersonId: narrator.id,
    });
    // recording (take 0) key first, then the follow-up take's key.
    expect(storageKeys).toEqual([
      "r2://chronicle/eleanor/take-0.webm",
      "r2://chronicle/eleanor/take-1.webm",
    ]);

    // No take rows survive, and the follow-up take's media row is gone too (no orphan).
    expect(await listStoryRecordings(db, story.id)).toHaveLength(0);
    expect(
      await db.select({ id: media.id }).from(media).where(eq(media.id, take1.id)),
    ).toHaveLength(0);
  });

  it("flips kind text→voice when the first take is appended to a typed-first draft", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const { story } = await createTextDraft(db, {
      ownerPersonId: narrator.id,
      text: "I typed this first.",
    });
    expect(story.kind).toBe("text");

    const { storyRecording } = await persistTakeRecording(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: "s3://b/take0.wav",
        contentType: "audio/wav",
        checksum: "c",
      },
      story.id,
    );
    expect(storyRecording.position).toBe(0);

    const [after] = await db.select().from(stories).where(eq(stories.id, story.id));
    expect(after!.kind).toBe("voice");
    // recording_media_id stays NULL for a typed-first draft (contract §3: pointer is not re-aimed).
    expect(after!.recordingMediaId).toBeNull();
  });

  it("leaves kind=voice unchanged when appending a follow-up take to a voice story", async () => {
    const narrator = await makePerson(db, "Sal");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id,
      storageKey: "s3://b/v0.wav",
      contentType: "audio/wav",
      checksum: "c0",
    });
    const { storyRecording } = await persistTakeRecording(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: "s3://b/v1.wav",
        contentType: "audio/wav",
        checksum: "c1",
      },
      story.id,
    );
    expect(storyRecording.position).toBe(1);
    const [after] = await db.select().from(stories).where(eq(stories.id, story.id));
    expect(after!.kind).toBe("voice");
  });
});
