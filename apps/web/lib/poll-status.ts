/**
 * The poll-until-ready loop shared by both capture surfaces (issue #2, slice 2b).
 *
 * After a capture returns, the client polls the viewer-scoped status read on a fixed cadence until
 * the story reaches `ready`, with a hard cap so the UI never spins forever. In dev/CI (no Inngest)
 * dispatch runs synchronously, so the first poll already returns `ready` — this loop resolves
 * immediately. In prod (durable Inngest) the loop bridges the gap between "capture returned" and
 * "story rendered".
 *
 * Kept as a pure async function (no React, no fetch) so it is directly unit-testable with fake
 * timers and reused verbatim by AnswerFlow (server action) and NarratorRecorder (fetch route).
 *
 * Outcomes:
 *   - "ready"   — a poll observed the `ready` status.
 *   - "failed"  — a poll observed the `failed` status (issue #11): a durable-job stage exhausted its
 *                 retries. Terminal — the loop returns immediately instead of waiting out the cap, so
 *                 the caller can surface a retry affordance right away.
 *   - "timeout" — the cap elapsed without ever seeing `ready` (the caller shows a soft "taking
 *                 longer than usual" message; the recording is safe, it's just slow or stuck).
 *   - "aborted" — the caller's AbortSignal fired (e.g. the component unmounted). The caller should
 *                 do nothing on this outcome.
 *
 * A `getStatus` rejection is treated as a transient miss (network blip / momentary 5xx): the loop
 * swallows it and keeps polling until the cap, rather than surfacing a hard error mid-processing.
 */
import type { AnswerStatus } from "./answer-status";

export const DEFAULT_POLL_INTERVAL_MS = 2500;
export const DEFAULT_POLL_TIMEOUT_MS = 180_000; // ~3 minutes

export type PollOutcome = "ready" | "failed" | "timeout" | "aborted";

export interface PollUntilReadyOptions {
  /** One status probe. May throw/reject — treated as a transient miss. */
  getStatus: () => Promise<AnswerStatus>;
  intervalMs?: number;
  timeoutMs?: number;
  /** Fires when the caller no longer cares (unmount); the loop resolves "aborted". */
  signal?: AbortSignal;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(id);
          resolve();
        },
        { once: true },
      );
    }
  });
}

export async function pollUntilReady(opts: PollUntilReadyOptions): Promise<PollOutcome> {
  const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + timeoutMs;

  for (;;) {
    if (opts.signal?.aborted) return "aborted";

    try {
      const status = await opts.getStatus();
      if (status === "ready") return "ready";
      if (status === "failed") return "failed"; // terminal — stop polling, let the caller offer retry
    } catch {
      // Transient miss — keep polling until the cap.
    }

    if (opts.signal?.aborted) return "aborted";
    // Stop once the next sleep would carry us past the cap: we've given it the full window.
    if (now() + intervalMs > deadline) return "timeout";

    await delay(intervalMs, opts.signal);
    if (opts.signal?.aborted) return "aborted";
  }
}
