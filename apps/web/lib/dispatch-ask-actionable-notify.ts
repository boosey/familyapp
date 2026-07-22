/**
 * Durable-vs-synchronous dispatch for the "Ask became actionable" askee ping (#276).
 * Mirrors `dispatch-story-shared-notify.ts`: Inngest configured → enqueue `ask.actionable.notify`;
 * else run the sync `deliver` closure in-request. Callers wrap in try/catch so ping failure never
 * blocks Ask creation.
 */
import type { JobQueue } from "@chronicle/pipeline";
import { plog } from "@chronicle/pipeline";

export interface DispatchAskActionableNotifyArgs {
  askId: string;
}

export type DispatchAskActionableNotify = (
  args: DispatchAskActionableNotifyArgs,
) => Promise<void>;

export interface DispatchAskActionableNotifyDeps {
  inngestConfigured: boolean;
  inngestJobQueue?: JobQueue;
  deliver: (args: { askId: string }) => Promise<void>;
}

export function makeDispatchAskActionableNotify(
  deps: DispatchAskActionableNotifyDeps,
): DispatchAskActionableNotify {
  return async (args: DispatchAskActionableNotifyArgs): Promise<void> => {
    if (deps.inngestConfigured && deps.inngestJobQueue) {
      plog("loop-ping", "dispatch: durable enqueue (Inngest worker delivers)", {
        ask: args.askId,
      });
      await deps.inngestJobQueue.enqueue("ask.actionable.notify", {
        askId: args.askId,
      });
      return;
    }
    plog("loop-ping", "dispatch: synchronous delivery (in-request)", {
      ask: args.askId,
    });
    await deps.deliver({ askId: args.askId });
  };
}
