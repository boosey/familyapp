/**
 * Parameterized durable-vs-sync JobQueue dispatch (#322) — shared by notify factories.
 */
import { describe, expect, it } from "vitest";
import type { EnqueuedJob, JobHandler, JobName, JobPayloadMap, JobQueue } from "@chronicle/pipeline";
import { makeDurableOrSyncDispatch } from "../lib/dispatch-durable-or-sync";

function fakeJobQueue(): JobQueue & { enqueued: Array<{ name: JobName; payload: unknown }> } {
  const enqueued: Array<{ name: JobName; payload: unknown }> = [];
  return {
    enqueued,
    async enqueue<N extends JobName>(name: N, payload: JobPayloadMap[N]): Promise<string> {
      enqueued.push({ name, payload });
      return "job-id";
    },
    register<N extends JobName>(_name: N, _handler: JobHandler<N>): void {},
    async drain(): Promise<void> {},
    pending(): EnqueuedJob[] {
      return [];
    },
  };
}

describe("makeDurableOrSyncDispatch", () => {
  it("UNCONFIGURED: calls the synchronous deliver closure with the payload", async () => {
    const delivered: Array<{ storyId: string }> = [];
    const jobQueue = fakeJobQueue();
    const dispatch = makeDurableOrSyncDispatch({
      jobName: "story.shared.notify",
      logScope: "loop-ping",
      logFields: (p) => ({ story: p.storyId }),
      inngestConfigured: false,
      inngestJobQueue: jobQueue,
      deliver: async (args) => {
        delivered.push(args);
      },
    });

    await dispatch({ storyId: "story-1" });

    expect(delivered).toEqual([{ storyId: "story-1" }]);
    expect(jobQueue.enqueued).toHaveLength(0);
  });

  it("CONFIGURED: enqueues the named job and does NOT deliver synchronously", async () => {
    const jobQueue = fakeJobQueue();
    let deliverCalls = 0;
    const dispatch = makeDurableOrSyncDispatch({
      jobName: "ask.actionable.notify",
      logScope: "loop-ping",
      logFields: (p) => ({ ask: p.askId }),
      inngestConfigured: true,
      inngestJobQueue: jobQueue,
      deliver: async () => {
        deliverCalls += 1;
      },
    });

    await dispatch({ askId: "ask-2" });

    expect(jobQueue.enqueued).toEqual([
      { name: "ask.actionable.notify", payload: { askId: "ask-2" } },
    ]);
    expect(deliverCalls).toBe(0);
  });

  it("CONFIGURED without a queue falls back to synchronous deliver", async () => {
    const delivered: Array<{ askId: string }> = [];
    const dispatch = makeDurableOrSyncDispatch({
      jobName: "ask.actionable.notify",
      logScope: "loop-ping",
      inngestConfigured: true,
      deliver: async (args) => {
        delivered.push(args);
      },
    });

    await dispatch({ askId: "ask-3" });

    expect(delivered).toEqual([{ askId: "ask-3" }]);
  });
});
