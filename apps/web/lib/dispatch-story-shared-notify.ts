/**
 * Durable-vs-synchronous dispatch for post-share loop-event pings (#270 / C13b).
 * Mirrors `dispatch-invite-delivery.ts`: Inngest configured → enqueue `story.shared.notify`;
 * else run the sync `deliver` closure in-request. Callers wrap in try/catch so ping failure
 * never blocks approve/share.
 */
import type { JobQueue } from "@chronicle/pipeline";
import { plog } from "@chronicle/pipeline";

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
  return async (args: DispatchStorySharedNotifyArgs): Promise<void> => {
    if (deps.inngestConfigured && deps.inngestJobQueue) {
      plog("loop-ping", "dispatch: durable enqueue (Inngest worker delivers)", {
        story: args.storyId,
      });
      await deps.inngestJobQueue.enqueue("story.shared.notify", {
        storyId: args.storyId,
      });
      return;
    }
    plog("loop-ping", "dispatch: synchronous delivery (in-request)", {
      story: args.storyId,
    });
    await deps.deliver({ storyId: args.storyId });
  };
}
