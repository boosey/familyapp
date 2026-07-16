/**
 * Terminal-pipeline-failure signal + retry bookkeeping (issue #11).
 *
 * These are the audited core writes a durable-job `onFailure` handler and the narrator-retry route
 * use: `markStoryProcessingFailed` stamps the DB signal (so the viewer-scoped status read can tell
 * "failed" from "slow"), and `beginStoryRetry` clears that signal + hands back a monotonic attempt
 * token (the dedupe-bust the durable queue needs to actually re-fire a stage).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  beginStoryRetry,
  getStoryForViewer,
  markStoryProcessingFailed,
  persistRecordingAndCreateDraft,
} from "../src/index";
import { PROCESSING_ERROR_MAX_CHARS } from "../src/constants";
import { makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function makeDraft(name: string, key: string) {
  const narrator = await makePerson(db, name);
  const { story } = await persistRecordingAndCreateDraft(db, {
    ownerPersonId: narrator.id,
    storageKey: key,
    contentType: "audio/webm",
    checksum: `sha256:${key}`,
  });
  return { narrator, story };
}

describe("markStoryProcessingFailed", () => {
  it("stamps the failure signal WITHOUT changing lifecycle state, surfaced via the front door", async () => {
    const { narrator, story } = await makeDraft("Eleanor", "fail-1");
    expect(story.processingFailedAt).toBeNull();
    expect(story.processingError).toBeNull();

    await markStoryProcessingFailed(db, story.id, "render_story: model timeout");

    const read = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narrator.id },
      story.id,
    );
    expect(read?.processingError).toBe("render_story: model timeout");
    expect(read?.processingFailedAt).toBeInstanceOf(Date);
    // Failure is a processing marker, NOT a lifecycle state — the story is still a draft.
    expect(read?.state).toBe("draft");
  });

  it("truncates a runaway error reason to the stored cap", async () => {
    const { narrator, story } = await makeDraft("Ada", "fail-2");
    const huge = "x".repeat(PROCESSING_ERROR_MAX_CHARS + 250);

    await markStoryProcessingFailed(db, story.id, huge);

    const read = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narrator.id },
      story.id,
    );
    expect(read?.processingError).toHaveLength(PROCESSING_ERROR_MAX_CHARS);
  });

  it("is a no-op (no throw) when the story no longer exists", async () => {
    await expect(
      markStoryProcessingFailed(db, "00000000-0000-0000-0000-000000000000", "gone"),
    ).resolves.toBeUndefined();
  });
});

describe("beginStoryRetry", () => {
  it("clears the failure marker and returns a monotonically bumped attempt token", async () => {
    const { narrator, story } = await makeDraft("Frida", "retry-1");
    await markStoryProcessingFailed(db, story.id, "transcribe: empty text");

    const first = await beginStoryRetry(db, story.id);
    expect(first).toBe(1);

    const afterFirst = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narrator.id },
      story.id,
    );
    expect(afterFirst?.processingError).toBeNull();
    expect(afterFirst?.processingFailedAt).toBeNull();

    // A second failure + retry bumps the token again — distinct dedupe-bust values.
    await markStoryProcessingFailed(db, story.id, "transcribe: empty text again");
    const second = await beginStoryRetry(db, story.id);
    expect(second).toBe(2);
  });

  it("returns null when there is no story to retry", async () => {
    const missing = await beginStoryRetry(db, "00000000-0000-0000-0000-000000000000");
    expect(missing).toBeNull();
  });

  it("is a compare-and-swap: a second retry of an already-cleared story matches no row → null (no double-dispatch)", async () => {
    const { story } = await makeDraft("Grace", "cas-1");
    await markStoryProcessingFailed(db, story.id, "boom");

    // First retry wins (marker was set) …
    expect(await beginStoryRetry(db, story.id)).toBe(1);
    // … a second retry, with the marker now cleared and no NEW failure, matches zero rows → null.
    // This is what stops two concurrent retry requests from both dispatching a paid pipeline run.
    expect(await beginStoryRetry(db, story.id)).toBeNull();
  });

  it("does not retry a draft that never failed (no marker → matches no row)", async () => {
    const { story } = await makeDraft("Hopper", "cas-2");
    expect(await beginStoryRetry(db, story.id)).toBeNull();
  });
});
