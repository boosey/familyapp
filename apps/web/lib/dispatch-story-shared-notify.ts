/**
 * Durable-vs-synchronous dispatch for post-share loop-event pings (#270 / C13b).
 * Thin wrapper over `makeDurableOrSyncDispatch` (#322): Inngest configured → enqueue
 * `story.shared.notify`; else run the sync `deliver` closure in-request. Callers wrap in
 * try/catch so ping failure never blocks approve/share.
 */
import type { JobQueue } from "@chronicle/pipeline";
import { makeDurableOrSyncDispatch } from "./dispatch-durable-or-sync";

export interface DispatchStorySharedNotifyArgs {
  storyId: string;
}

export type DispatchStorySharedNotify = (
  args: DispatchStorySharedNotifyArgs,
) => Promise<void>;

export interface DispatchStorySharedNotifyDeps {
  inngestConfigured: boolean;
  inngestJobQueue?: JobQueue;
  deliver: (args: { storyId: string }) => Promise<void>;
}

export function makeDispatchStorySharedNotify(
  deps: DispatchStorySharedNotifyDeps,
): DispatchStorySharedNotify {
  return makeDurableOrSyncDispatch({
    jobName: "story.shared.notify",
    logScope: "loop-ping",
    logFields: (p) => ({ story: p.storyId }),
    inngestConfigured: deps.inngestConfigured,
    ...(deps.inngestJobQueue ? { inngestJobQueue: deps.inngestJobQueue } : {}),
    deliver: deps.deliver,
  });
}
