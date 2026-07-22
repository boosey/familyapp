/**
 * Durable-vs-synchronous dispatch for ask.actionable.notify (#276).
 */
import { describe, expect, it } from "vitest";
import type { EnqueuedJob, JobHandler, JobName, JobPayloadMap, JobQueue } from "@chronicle/pipeline";
import { makeDispatchAskActionableNotify } from "../lib/dispatch-ask-actionable-notify";

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

describe("makeDispatchAskActionableNotify — branch selection", () => {
  it("UNCONFIGURED: calls the synchronous deliver closure", async () => {
    const delivered: Array<{ askId: string }> = [];
    const jobQueue = fakeJobQueue();
    const dispatch = makeDispatchAskActionableNotify({
      inngestConfigured: false,
      inngestJobQueue: jobQueue,
      deliver: async (args) => {
        delivered.push(args);
      },
    });

    await dispatch({ askId: "ask-1" });

    expect(delivered).toEqual([{ askId: "ask-1" }]);
    expect(jobQueue.enqueued).toHaveLength(0);
  });

  it("CONFIGURED: enqueues ask.actionable.notify and does NOT deliver synchronously", async () => {
    const jobQueue = fakeJobQueue();
    let deliverCalls = 0;
    const dispatch = makeDispatchAskActionableNotify({
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
});
