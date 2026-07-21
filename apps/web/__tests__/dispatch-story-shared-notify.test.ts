/**
 * Durable-vs-synchronous dispatch for story.shared.notify (#270).
 */
import { describe, expect, it } from "vitest";
import type { EnqueuedJob, JobHandler, JobName, JobPayloadMap, JobQueue } from "@chronicle/pipeline";
import { makeDispatchStorySharedNotify } from "../lib/dispatch-story-shared-notify";

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

describe("makeDispatchStorySharedNotify — branch selection", () => {
  it("UNCONFIGURED: calls the synchronous deliver closure", async () => {
    const delivered: Array<{ storyId: string }> = [];
    const jobQueue = fakeJobQueue();
    const dispatch = makeDispatchStorySharedNotify({
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

  it("CONFIGURED: enqueues story.shared.notify and does NOT deliver synchronously", async () => {
    const jobQueue = fakeJobQueue();
    let deliverCalls = 0;
    const dispatch = makeDispatchStorySharedNotify({
      inngestConfigured: true,
      inngestJobQueue: jobQueue,
      deliver: async () => {
        deliverCalls += 1;
      },
    });

    await dispatch({ storyId: "story-2" });

    expect(jobQueue.enqueued).toEqual([
      { name: "story.shared.notify", payload: { storyId: "story-2" } },
    ]);
    expect(deliverCalls).toBe(0);
  });
});
