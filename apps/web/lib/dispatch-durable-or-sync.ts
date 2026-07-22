/**
 * Parameterized durable-vs-synchronous JobQueue dispatch (#322).
 *
 * Inngest configured → enqueue `jobName` with the typed payload; else run the sync
 * `deliver` closure in-request. Notify factories (story-shared, ask-actionable, and
 * future ping types) are thin wrappers over this helper. Digest assembly (#277) can
 * enqueue a digest job name through the same seam once that worker exists.
 *
 * Callers wrap dispatch in try/catch so failure never blocks the write path.
 */
import type { JobName, JobPayloadMap, JobQueue } from "@chronicle/pipeline";
import { plog } from "@chronicle/pipeline";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface MakeDurableOrSyncDispatchDeps<N extends JobName> {
  jobName: N;
  /** `plog` scope (e.g. `"loop-ping"`). */
  logScope: string;
  /** Optional structured fields for dispatch logs. Defaults to the raw payload. */
  logFields?: (payload: JobPayloadMap[N]) => LogFields;
  inngestConfigured: boolean;
  inngestJobQueue?: JobQueue;
  deliver: (payload: JobPayloadMap[N]) => Promise<void>;
}

export function makeDurableOrSyncDispatch<N extends JobName>(
  deps: MakeDurableOrSyncDispatchDeps<N>,
): (payload: JobPayloadMap[N]) => Promise<void> {
  return async (payload: JobPayloadMap[N]): Promise<void> => {
    const fields: LogFields =
      deps.logFields?.(payload) ?? (payload as unknown as LogFields);
    if (deps.inngestConfigured && deps.inngestJobQueue) {
      plog(deps.logScope, "dispatch: durable enqueue (Inngest worker delivers)", fields);
      await deps.inngestJobQueue.enqueue(deps.jobName, payload);
      return;
    }
    plog(deps.logScope, "dispatch: synchronous delivery (in-request)", fields);
    await deps.deliver(payload);
  };
}
