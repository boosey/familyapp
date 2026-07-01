/**
 * Tests for the durable-vs-synchronous dispatch decision (lib/dispatch-pipeline.ts) — the load-
 * bearing branch of SLICE 2a. Two layers:
 *
 *  1. Branch selection with FAKE pipelines (fast, exact): the unconfigured path drains to
 *     completion; the configured path enqueues ONLY and never drains.
 *  2. An end-to-end run of the UNCONFIGURED path on a REAL in-process pipeline + PGlite, proving a
 *     freshly-ingested draft actually reaches `pending_approval` in-request (the property the
 *     existing capture sites and the hermetic e2e suite rely on — dev stays synchronous).
 */
import { describe, expect, it } from "vitest";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import {
  getStoryForViewer,
  persistRecordingAndCreateDraft,
  type AuthContext,
} from "@chronicle/core";
import {
  createPipeline,
  ScriptedLanguageModel,
  ScriptedTranscriber,
  type Pipeline,
} from "@chronicle/pipeline";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { makeDispatchPipeline } from "../lib/dispatch-pipeline";

/** A Pipeline test double that records which lifecycle methods were called. */
function fakePipeline(): Pipeline & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async start(storyId: string) {
      calls.push(`start:${storyId}`);
    },
    async runToCompletion() {
      calls.push("runToCompletion");
    },
    async runTranscribeStage() {
      calls.push("runTranscribeStage");
    },
    async runRenderStoryStage() {
      calls.push("runRenderStoryStage");
    },
    // queue is unused by makeDispatchPipeline; satisfy the type with a no-op stub.
    queue: {
      async enqueue() {
        return "noop";
      },
      async drain() {},
      pending() {
        return [];
      },
      register() {},
    },
  };
}

describe("makeDispatchPipeline — branch selection", () => {
  it("UNCONFIGURED: builds a fresh in-process pipeline and runs it to completion", async () => {
    const built: Array<Pipeline & { calls: string[] }> = [];
    const dispatch = makeDispatchPipeline({
      inngestConfigured: false,
      newPipeline: () => {
        const p = fakePipeline();
        built.push(p);
        return p;
      },
    });

    await dispatch("story-1");

    expect(built).toHaveLength(1);
    // Synchronous path: start THEN drain, both in-request.
    expect(built[0]!.calls).toEqual(["start:story-1", "runToCompletion"]);
  });

  it("CONFIGURED: enqueues onto the shared Inngest pipeline and does NOT drain", async () => {
    const inngestPipeline = fakePipeline();
    let inProcessBuilds = 0;
    const dispatch = makeDispatchPipeline({
      inngestConfigured: true,
      inngestPipeline,
      newPipeline: () => {
        inProcessBuilds += 1;
        return fakePipeline();
      },
    });

    await dispatch("story-2");

    // Enqueue-only: start was called, runToCompletion was NOT (Inngest drives execution).
    expect(inngestPipeline.calls).toEqual(["start:story-2"]);
    expect(inngestPipeline.calls).not.toContain("runToCompletion");
    // The synchronous in-process factory is never touched on the durable path.
    expect(inProcessBuilds).toBe(0);
  });

  it("CONFIGURED but no shared pipeline supplied: falls back to the synchronous path (defensive)", async () => {
    const built: Array<Pipeline & { calls: string[] }> = [];
    const dispatch = makeDispatchPipeline({
      inngestConfigured: true,
      newPipeline: () => {
        const p = fakePipeline();
        built.push(p);
        return p;
      },
    });

    await dispatch("story-3");

    expect(built).toHaveLength(1);
    expect(built[0]!.calls).toEqual(["start:story-3", "runToCompletion"]);
  });
});

describe("makeDispatchPipeline — unconfigured path drives a real story to pending_approval", () => {
  async function seedDraft(db: Database, storage: InMemoryMediaStorage): Promise<{
    storyId: string;
    ownerId: string;
  }> {
    const [owner] = await db
      .insert(persons)
      .values({ displayName: "Eleanor", spokenName: "Eleanor", birthYear: 1942 })
      .returning();
    const ownerId = owner!.id;
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const storageKey = `story-audio/${ownerId}/test.webm`;
    await storage.put({ key: storageKey, bytes, contentType: "audio/webm" });
    const persisted = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: ownerId,
      storageKey,
      contentType: "audio/webm",
      durationSeconds: 60,
      checksum: "sha256:test",
    });
    return { storyId: persisted.story.id, ownerId };
  }

  it("reaches pending_approval in-request (real in-process pipeline)", async () => {
    const db = await createTestDatabase();
    const storage = new InMemoryMediaStorage();
    const { storyId, ownerId } = await seedDraft(db, storage);

    const dispatch = makeDispatchPipeline({
      inngestConfigured: false,
      newPipeline: () =>
        createPipeline({
          db,
          storage,
          transcriber: new ScriptedTranscriber({ text: "I was born on a farm." }),
          languageModel: new ScriptedLanguageModel(),
        }),
    });

    await dispatch(storyId);

    const ctx: AuthContext = { kind: "account", personId: ownerId };
    const story = await getStoryForViewer(db, ctx, storyId);
    expect(story?.state).toBe("pending_approval");
  });
});
