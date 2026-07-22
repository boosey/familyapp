/**
 * Durable-vs-synchronous dispatch for the "Ask became actionable" askee ping (#276).
 * Thin wrapper over `makeDurableOrSyncDispatch` (#322): Inngest configured → enqueue
 * `ask.actionable.notify`; else run the sync `deliver` closure in-request. Callers wrap in
 * try/catch so ping failure never blocks Ask creation.
 */
import type { JobQueue } from "@chronicle/pipeline";
import { makeDurableOrSyncDispatch } from "./dispatch-durable-or-sync";

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
  return makeDurableOrSyncDispatch({
    jobName: "ask.actionable.notify",
    logScope: "loop-ping",
    logFields: (p) => ({ ask: p.askId }),
    inngestConfigured: deps.inngestConfigured,
    ...(deps.inngestJobQueue ? { inngestJobQueue: deps.inngestJobQueue } : {}),
    deliver: deps.deliver,
  });
}
