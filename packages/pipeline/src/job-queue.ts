/**
 * `InProcessJobQueue` — the dev/test impl of the `JobQueue` seam. It is deliberately small:
 * enqueue puts a job on a pending list, `drain` runs them in order, handlers must be idempotent.
 * Production swaps in an Inngest adapter (same interface, durable retries) — the orchestrator
 * code does not change. Because every stage handler is built idempotent (re-running with the
 * same payload produces the same outputs without duplicate side effects), retries are safe.
 *
 * Pending-dedupe: if two enqueues produce the same `jobDedupeKey(name, payload)` (the per-job-name
 * dedupe key — see contracts.ts) while a prior is still pending, the second enqueue is a no-op.
 * This mirrors what a real durable queue's dedupe key would do and keeps tests honest — a callsite
 * that retries enqueuing should not pile up duplicate work.
 */
import { randomUUID } from "node:crypto";
import type {
  EnqueuedJob,
  JobFailureHandler,
  JobHandler,
  JobName,
  JobPayloadMap,
  JobQueue,
} from "./contracts";
import { jobDedupeKey } from "./contracts";
// PIPELINE_JOB_MAX_ATTEMPTS: hard cap on attempts per job-id in the in-process queue. A handler
// that re-enqueues itself (e.g. render_story re-queueing transcribe when the transcript isn't
// ready) under a real bug could otherwise spin forever — production Inngest caps retries, this
// matches that behavior. Crossed-cap jobs raise so a test/reviewer sees the loop instead of CPU.
import { PIPELINE_JOB_MAX_ATTEMPTS } from "./constants";

export class InProcessJobQueue implements JobQueue {
  private readonly queue: EnqueuedJob[] = [];
  private readonly handlers = new Map<JobName, JobHandler>();
  private readonly failureHandlers = new Map<JobName, JobFailureHandler>();
  private readonly attemptsById = new Map<string, number>();
  private draining = false;

  async enqueue<N extends JobName>(name: N, payload: JobPayloadMap[N]): Promise<string> {
    const key = jobDedupeKey(name, payload);
    const existing = this.queue.find((j) => jobDedupeKey(j.name, j.payload) === key);
    if (existing) return existing.id;
    const job: EnqueuedJob = {
      id: randomUUID(),
      name,
      payload,
      enqueuedAt: new Date(),
      attempts: 0,
    };
    this.queue.push(job);
    return job.id;
  }

  register<N extends JobName>(
    name: N,
    handler: JobHandler<N>,
    onFailure?: JobFailureHandler<N>,
  ): void {
    this.handlers.set(name, handler as JobHandler);
    if (onFailure) this.failureHandlers.set(name, onFailure as JobFailureHandler);
    else this.failureHandlers.delete(name);
  }

  async drain(): Promise<void> {
    // Re-entrant drains are a no-op — the outer drain's while-loop will pick up jobs that
    // handlers enqueue during their own execution. (Without this guard, nested calls would
    // race over `this.queue.shift()`.)
    if (this.draining) return;
    this.draining = true;
    this.attemptsById.clear();
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        const handler = this.handlers.get(job.name);
        if (!handler) {
          throw new Error(`no handler registered for job: ${job.name}`);
        }
        const key = jobDedupeKey(job.name, job.payload);
        const attempts = (this.attemptsById.get(key) ?? 0) + 1;
        this.attemptsById.set(key, attempts);
        if (attempts > PIPELINE_JOB_MAX_ATTEMPTS) {
          throw new Error(
            `job '${job.name}' (key '${key}') exceeded ${PIPELINE_JOB_MAX_ATTEMPTS} attempts in one drain — likely a handler re-queueing itself in a loop`,
          );
        }
        job.attempts = attempts;
        try {
          await handler(job.payload);
        } catch (err) {
          // The in-process queue has no retry budget, so a single throw IS terminal — mirror the
          // durable queue's post-retries `onFailure` (issue #11). We still RE-THROW the original
          // error afterward so drain's existing "a failing job surfaces to the caller" contract is
          // unchanged (the dev synchronous dispatch and every existing test still see the error).
          const onFailure = this.failureHandlers.get(job.name);
          if (onFailure) {
            const info =
              err instanceof Error
                ? { message: err.message, name: err.name }
                : { message: String(err) };
            try {
              await onFailure(job.payload, info);
            } catch {
              // A failure handler that itself throws must not mask the original stage error.
            }
          }
          throw err;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  pending(): EnqueuedJob[] {
    return this.queue.slice();
  }
}
