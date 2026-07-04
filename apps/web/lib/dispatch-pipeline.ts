/**
 * The transcribe→render dispatch decision, factored out of `lib/runtime.ts` so it is a pure,
 * directly-testable unit (no `server-only`, no PGlite boot). `build()` in runtime.ts wires the
 * real dependencies into `makeDispatchPipeline` and exposes the result as `Runtime.dispatchPipeline`.
 *
 * Two honest branches, mirroring the env-switch idiom used everywhere else in runtime.ts:
 *
 *   - Inngest CONFIGURED (prod durable path): ENQUEUE ONLY. We call `inngestPipeline.start(storyId)`,
 *     which sends the `chronicle/transcribe` event, and return immediately. We deliberately do NOT
 *     call `runToCompletion()` — the Inngest adapter's `drain()` is a documented no-op (Inngest's
 *     own runtime, not our request thread, drives the stages to completion). Calling it would be a
 *     misleading no-op that implies in-request execution.
 *
 *   - Inngest UNCONFIGURED (dev/CI synchronous path): preserve TODAY'S behavior EXACTLY — build a
 *     FRESH in-process pipeline (its own single-flight in-process queue, per the Runtime.newPipeline
 *     rationale), start it, and drain it to completion in-request so the story reaches
 *     `pending_approval` before the caller returns. This keeps every existing web test and the
 *     hermetic e2e suite green and ensures no lingering `draft` arises in dev.
 */
import { plog, startTimer, type Pipeline } from "@chronicle/pipeline";

export interface DispatchPipelineDeps {
  /** When true, enqueue onto the shared durable Inngest pipeline; else run the in-process path. */
  inngestConfigured: boolean;
  /** Fresh-per-call in-process pipeline factory (the dev/CI synchronous path). */
  newPipeline: () => Pipeline;
  /**
   * The ONE module-scope-shared Inngest pipeline whose real stage handlers are registered on the
   * Inngest queue. Present iff `inngestConfigured` is true. (When configured we enqueue onto this
   * shared instance rather than building a fresh one — the Inngest queue holds no per-call state.)
   */
  inngestPipeline?: Pipeline;
}

export type DispatchPipeline = (storyId: string) => Promise<void>;

export function makeDispatchPipeline(deps: DispatchPipelineDeps): DispatchPipeline {
  return async (storyId: string): Promise<void> => {
    // Correlates under the caller's log context (e.g. /api/capture's `beginLogContext`) so this line
    // shares that run's cid. Names which of the two honest branches this dispatch took.
    if (deps.inngestConfigured && deps.inngestPipeline) {
      // Durable path: enqueue the first stage and return. Inngest drives the rest.
      plog("pipeline", "dispatch: durable enqueue (Inngest drives stages)", { story: storyId });
      await deps.inngestPipeline.start(storyId);
      return;
    }
    // Synchronous dev/CI path: fresh pipeline, start, and drain in-request.
    plog("pipeline", "dispatch: synchronous drain (in-request)", { story: storyId });
    const drainTimer = startTimer();
    const pipeline = deps.newPipeline();
    await pipeline.start(storyId);
    await pipeline.runToCompletion();
    plog("pipeline", "dispatch: synchronous drain complete", { story: storyId, ms: drainTimer() });
  };
}
