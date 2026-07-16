/**
 * Terminal-failure signal + retry plumbing at the pipeline layer (issue #11).
 *
 * Three things are pinned here:
 *  1. The in-process queue invokes a registered `onFailure` when a handler throws (its single
 *     attempt IS terminal), then still re-throws so drain's existing contract is unchanged.
 *  2. End-to-end: a stage that throws leaves a DB failure signal on the story (via the orchestrator's
 *     wired `markStoryProcessingFailed`) — the whole reason the issue exists.
 *  3. The retry `attempt` is carried verbatim through internal stage cascades (dedupe-bust token).
 */
import {
  getStoryForViewer,
  persistRecordingAndCreateDraft,
  updateDerivedFields,
} from "@chronicle/core";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPipeline,
  InProcessJobQueue,
  ScriptedLanguageModel,
  ScriptedTranscriber,
  type JobName,
  type JobPayload,
  type JobQueue,
} from "../src/index";

let db: Database;
let storage: InMemoryMediaStorage;

beforeEach(async () => {
  db = await createTestDatabase();
  storage = new InMemoryMediaStorage();
});

async function seedVoiceDraft(): Promise<string> {
  const [narrator] = await db
    .insert(persons)
    .values({ displayName: "Eleanor", spokenName: "Eleanor", birthYear: 1942 })
    .returning();
  const key = `story-audio/${narrator!.id}/t.webm`;
  await storage.put({ key, bytes: new Uint8Array([1, 2, 3, 4]), contentType: "audio/webm" });
  const { story } = await persistRecordingAndCreateDraft(db, {
    ownerPersonId: narrator!.id,
    storageKey: key,
    contentType: "audio/webm",
    durationSeconds: 60,
    checksum: "sha256:seed",
  });
  return story.id;
}

describe("InProcessJobQueue — onFailure (issue #11)", () => {
  it("invokes onFailure with the payload + error info, then re-throws the original error", async () => {
    const q = new InProcessJobQueue();
    const onFailure = vi.fn(async () => {});
    q.register(
      "transcribe",
      async () => {
        throw new Error("stage exploded");
      },
      onFailure,
    );
    await q.enqueue("transcribe", { storyId: "s-1", attempt: 4 });

    await expect(q.drain()).rejects.toThrow("stage exploded");
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(
      { storyId: "s-1", attempt: 4 },
      { message: "stage exploded", name: "Error" },
    );
  });

  it("a handler that throws with NO onFailure registered still propagates (no crash)", async () => {
    const q = new InProcessJobQueue();
    q.register("transcribe", async () => {
      throw new Error("boom");
    });
    await q.enqueue("transcribe", { storyId: "s-2" });
    await expect(q.drain()).rejects.toThrow("boom");
  });

  it("a failure handler that itself throws does not mask the original stage error", async () => {
    const q = new InProcessJobQueue();
    q.register(
      "render_story",
      async () => {
        throw new Error("original");
      },
      async () => {
        throw new Error("secondary");
      },
    );
    await q.enqueue("render_story", { storyId: "s-3" });
    await expect(q.drain()).rejects.toThrow("original");
  });
});

describe("orchestrator — terminal failure marks the story (issue #11)", () => {
  it("a transcribe that throws leaves a DB failure signal (state stays draft)", async () => {
    const storyId = await seedVoiceDraft();
    // Empty transcriber text is a terminal vendor failure the transcribe stage throws on.
    const transcriber = new ScriptedTranscriber({ text: "" });
    const languageModel = new ScriptedLanguageModel();
    const pipeline = createPipeline({ db, storage, transcriber, languageModel });

    await pipeline.start(storyId);
    await expect(pipeline.runToCompletion()).rejects.toThrow(/empty text/);

    // Assert the failure signal through the audited front door as the owner.
    const ownerId = (await db.select({ id: persons.id }).from(persons).limit(1))[0]!.id;
    const read = await getStoryForViewer(
      db,
      { kind: "link_session", personId: ownerId },
      storyId,
    );
    expect(read?.state).toBe("draft");
    expect(read?.processingFailedAt).toBeInstanceOf(Date);
    expect(read?.processingError).toMatch(/^transcribe: /);
  });
});

describe("orchestrator — attempt propagation (issue #11)", () => {
  it("carries `attempt` from an incoming payload into the cascaded render_story enqueue", async () => {
    const storyId = await seedVoiceDraft();
    // Pre-seed a transcript so transcribe hits its 'already transcribed → enqueue render_story' branch.
    await updateDerivedFields(db, storyId, { transcript: "already here" });

    const calls: Array<{ name: JobName; payload: JobPayload }> = [];
    const recordingQueue: JobQueue = {
      async enqueue(name, payload) {
        calls.push({ name, payload });
        return "job-id";
      },
      register() {},
      async drain() {},
      pending() {
        return [];
      },
    };
    const pipeline = createPipeline({
      db,
      storage,
      transcriber: new ScriptedTranscriber({ text: "unused" }),
      languageModel: new ScriptedLanguageModel(),
      jobQueue: recordingQueue,
    });

    await pipeline.runTranscribeStage({ storyId, attempt: 7 });

    expect(calls).toEqual([{ name: "render_story", payload: { storyId, attempt: 7 } }]);
  });

  it("omits `attempt` entirely on the initial run so the dedupe id is unchanged from history", async () => {
    const storyId = await seedVoiceDraft();
    await updateDerivedFields(db, storyId, { transcript: "already here" });

    const calls: Array<{ name: JobName; payload: JobPayload }> = [];
    const recordingQueue: JobQueue = {
      async enqueue(name, payload) {
        calls.push({ name, payload });
        return "job-id";
      },
      register() {},
      async drain() {},
      pending() {
        return [];
      },
    };
    const pipeline = createPipeline({
      db,
      storage,
      transcriber: new ScriptedTranscriber({ text: "unused" }),
      languageModel: new ScriptedLanguageModel(),
      jobQueue: recordingQueue,
    });

    await pipeline.runTranscribeStage({ storyId });

    expect(calls).toEqual([{ name: "render_story", payload: { storyId } }]);
    expect("attempt" in calls[0]!.payload).toBe(false);
  });
});
