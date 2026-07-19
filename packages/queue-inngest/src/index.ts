/**
 * Inngest adapter for the `JobQueue` seam.
 *
 * Lives outside the IP packages on purpose — the vendor-SDK guard in
 * `packages/pipeline/test/pipeline.test.ts` only scans
 * `@chronicle/{core,db,storage,capture,pipeline,interviewer}`. This file is the only place
 * `inngest` may be imported. The orchestration / idempotency / story-state IP still lives in
 * `@chronicle/pipeline` and `@chronicle/core`; this adapter just translates `enqueue` into
 * `inngest.send` and `register` into an `InngestFunction` the Next.js `serve` handler can mount.
 *
 * ## Honest-to-the-contract trade-offs
 *
 * The `JobQueue` contract was shaped around the in-process impl in
 * `packages/pipeline/src/job-queue.ts`, where `drain()` runs every pending job in the caller's
 * thread and `pending()` returns the local queue. Inngest is event-driven: once `send` returns,
 * Inngest's runtime (cloud or `inngest-cli dev`) drives execution. We deliberately collapse the
 * two methods that have no honest mapping:
 *
 *   - `drain()` is a **no-op** that resolves immediately. There is no in-process queue to drain.
 *     Tests that need to drive jobs to completion should construct an `InProcessJobQueue`
 *     instead — that is the dev/test impl the contract was sized for.
 *   - `pending()` returns `[]`. Inngest holds the truth; we do not mirror it here. Observability
 *     belongs to the Inngest dashboard / cli, not this adapter.
 *   - `enqueue`'s dedupe id is honored by Inngest's send-side dedupe for a **24-hour window
 *     only** — not an indefinite presence-based check. The orchestrator's idempotency gates
 *     inside the handler remain the true duplicate guard; re-enqueues 24h+ apart can run twice,
 *     which is acceptable because handlers are idempotent.
 *
 * All three decisions are documented loudly here rather than papered over with a half-honest
 * implementation (e.g. polling the Inngest dev-server API), because the orchestrator only ever
 * calls `enqueue` and `register` in production — `drain`/`pending` exist for the in-process impl.
 *
 * ## Idempotency
 *
 * Inngest natively dedupes events with the same `id` within a short window (24h), so every
 * `enqueue` computes a deterministic id from `sha256("<JobName>:" + canonicalJson(payload))`.
 * Re-enqueueing an identical (name, payload) within that window returns the same id and produces
 * no duplicate runs. See the trade-off note above for the long-window caveat.
 *
 * ## Wiring (app/web)
 *
 * ```ts
 * // apps/web/app/api/inngest/route.ts
 * import { serve } from "inngest/next";
 * import { createInngestJobQueue } from "@chronicle/queue-inngest";
 * import { Inngest } from "inngest";
 *
 * const client = new Inngest({ id: "family-chronicle" });
 * const queue = createInngestJobQueue({ client });
 * // register handlers BEFORE wiring `serve` — the `functions` getter returns a FRESH array on
 * // every read, so call it AFTER all `register(...)` calls have run.
 * queue.register("transcribe", async (p) => { ... });
 * queue.register("render_story", async (p) => { ... });
 *
 * // The signing key is a `serve()` concern (CommHandler), not a client concern — pass it here
 * // (or rely on `INNGEST_SIGNING_KEY` in env, which `serve` reads on its own).
 * export const { GET, POST, PUT } = serve({
 *   client,
 *   functions: queue.functions,
 *   signingKey: process.env.INNGEST_SIGNING_KEY,
 * });
 * ```
 */
import { createHash } from "node:crypto";
import { Inngest, type InngestFunction } from "inngest";
import type {
  EnqueuedJob,
  JobFailureHandler,
  JobHandler,
  JobName,
  JobPayload,
  JobPayloadMap,
  JobQueue,
} from "@chronicle/pipeline";

/** Event-name prefix we put on every Chronicle pipeline event. */
const EVENT_PREFIX = "chronicle";

/** Subset of `Inngest` we actually call — narrow so tests can inject a tiny stub. */
export interface InngestLike {
  send(payload: {
    name: string;
    data: Record<string, unknown>;
    id?: string;
  }): Promise<unknown>;
  createFunction: Inngest["createFunction"];
}

export interface InngestJobQueueOptions {
  /** Inject a pre-built client (tests, or a client shared with other features). */
  client?: InngestLike;
  /** Used when constructing a client if `client` is not supplied. */
  appId?: string;
  /** Event key for self-hosted / prod. Reads `INNGEST_EVENT_KEY` if omitted. */
  eventKey?: string;
}

export interface InngestJobQueue extends JobQueue {
  /**
   * The `InngestFunction[]` to pass to `serve({ client, functions })`. Returns a **fresh array**
   * on every read, derived from an internal `Map<JobName, InngestFunction>`. Call this AFTER
   * all `register(...)` calls have run — the returned array is a snapshot, not a live view.
   * Register-replace semantics: re-registering the same `JobName` overwrites the prior entry.
   */
  readonly functions: InngestFunction.Any[];
  /** The underlying Inngest client (handy for tests / advanced wiring). */
  readonly client: InngestLike;
  /**
   * Register a SCHEDULED function (issue #90). The `JobQueue` contract is event-shaped — there
   * is no honest cron mapping for the in-process impl — so cron is an Inngest-only capability
   * living on this adapter, not the shared contract. `name` is a bare slug (the adapter applies
   * the same `chronicle-` id prefix as event functions); `cron` is a standard 5-field expression
   * (UTC). The handler's return value becomes the Inngest run output — return the job's counts
   * so the dashboard carries the observability. The function is included in the `functions`
   * snapshot alongside event registrations.
   */
  registerCron(name: string, cron: string, handler: () => Promise<unknown>): void;
}

export function createInngestJobQueue(
  opts: InngestJobQueueOptions = {},
): InngestJobQueue {
  const client: InngestLike =
    opts.client ??
    new Inngest({
      id: opts.appId ?? "family-chronicle",
      ...(opts.eventKey ? { eventKey: opts.eventKey } : {}),
    });

  // Keyed by our internal `JobName` so replace-on-re-register is structurally correct,
  // independent of how the real `InngestFunction.id()` formats the (prefixed) id string.
  const functionsByName = new Map<JobName, InngestFunction.Any>();
  // Cron-triggered functions (issue #90) have no JobName — keyed by their bare slug so a
  // re-register REPLACES (same discipline as event register): a duplicate function id would make
  // Inngest reject the whole serve sync, taking every function down with it.
  const cronFunctionsByName = new Map<string, InngestFunction.Any>();

  return {
    client,
    get functions(): InngestFunction.Any[] {
      // Fresh array per call — see interface docstring.
      return [...functionsByName.values(), ...cronFunctionsByName.values()];
    },

    async enqueue<N extends JobName>(name: N, payload: JobPayloadMap[N]): Promise<string> {
      const id = dedupeId(name, payload);
      await client.send({
        name: eventName(name),
        data: payload as unknown as Record<string, unknown>,
        id,
      });
      return id;
    },

    register<N extends JobName>(
      name: N,
      handler: JobHandler<N>,
      onFailure?: JobFailureHandler<N>,
    ): void {
      // `onFailure` (issue #11) fires AFTER Inngest exhausts the function's retries — the durable-
      // queue analogue of a terminal failure. We translate the vendor's `{ error, event }` back into
      // our vendor-neutral (payload, JobFailureInfo) so the orchestrator's handler stays SDK-free.
      const config = {
        id: functionId(name),
        ...(onFailure
          ? {
              onFailure: async ({ event, error }: InngestFailureArgs) => {
                // Belt-and-suspenders: a terminal-failure recorder should be side-effect-only, but we
                // must never let it throw INSIDE Inngest's onFailure hook (that would destabilize the
                // vendor callback). Swallow — the handler owns its own logging.
                try {
                  await onFailure(originalPayload(event) as JobPayloadMap[N], {
                    message: String(error?.message ?? "unknown error"),
                    ...(error?.name ? { name: String(error.name) } : {}),
                  });
                } catch {
                  // Intentionally ignored — see above.
                }
              },
            }
          : {}),
      };
      const fn = client.createFunction(
        config,
        { event: eventName(name) },
        async ({ event }: { event: { data: unknown } }) => {
          await handler(event.data as JobPayloadMap[N]);
        },
      );
      // Map.set is the replace — no fragile string compare against `.id()` needed.
      functionsByName.set(name, fn);
    },

    registerCron(name: string, cron: string, handler: () => Promise<unknown>): void {
      // No event/dedupe id concerns here — Inngest's scheduler is the only trigger, and the
      // handler's return value is captured as the run output (the reaper's counts, issue #90).
      const fn = client.createFunction(
        { id: functionId(name) },
        { cron },
        async () => handler(),
      );
      cronFunctionsByName.set(name, fn);
    },

    /**
     * No-op. See file docstring: Inngest drives execution; there is no in-thread queue to drain.
     * Use `InProcessJobQueue` from `@chronicle/pipeline` for tests that need to run jobs inline.
     */
    async drain(): Promise<void> {
      return;
    },

    /**
     * Always `[]`. See file docstring: Inngest holds the source of truth for pending work; this
     * adapter does not mirror it. Use the Inngest dashboard / `inngest-cli dev` for visibility.
     */
    pending(): EnqueuedJob[] {
      return [];
    },
  };
}

/**
 * Shape we read off Inngest's `onFailure` context. Deliberately minimal + structural so we don't
 * couple to the SDK's full failure-context type: we only need the original event's `data` and the
 * error summary. Kept loose (`unknown` inner) because we defensively normalize in `originalPayload`.
 */
interface InngestFailureArgs {
  event: { data?: unknown };
  error?: { message?: unknown; name?: unknown };
}

/**
 * Recover the ORIGINAL `JobPayload` from an `onFailure` event. In the current JS SDK the `event`
 * passed to `onFailure` IS the original triggering event, so `event.data` is the payload. Older
 * shapes nested it under the `inngest/function.failed` wrapper at `event.data.event.data`; we accept
 * either so a minor SDK bump can't silently strand the storyId (which would drop the failure signal).
 *
 * NOTE: the `"storyId" in data` structural checks are story-shaped-payload probes — they only fire
 * for the pipeline stages (`transcribe`/`render_story`). An invite (`invite.send`) payload has no
 * `storyId`, so it falls through to the last-resort `(data ?? {})` return. That is functionally
 * correct: in the flat (current-SDK) shape `event.data` IS the real payload, so we still hand back
 * the genuine `InviteJobPayload` — the probes are only an ordering optimization + nested-shape
 * fallback, not a story-only gate.
 */
function originalPayload(event?: { data?: unknown } | null): JobPayload {
  const data = event?.data;
  if (data && typeof data === "object" && "storyId" in data) {
    return data as JobPayload;
  }
  const nested = (data as { event?: { data?: unknown } } | undefined)?.event?.data;
  if (nested && typeof nested === "object" && "storyId" in nested) {
    return nested as JobPayload;
  }
  // Last resort: hand back whatever we have cast to the contract; the core marker is a no-op on a
  // missing/blank storyId rather than a crash, so we degrade to "no signal" not "throw in onFailure".
  return (data ?? {}) as JobPayload;
}

/** `transcribe` -> `chronicle/transcribe`. */
function eventName(name: JobName): string {
  return `${EVENT_PREFIX}/${name}`;
}

/** Stable function id per stage/cron slug — survives re-register. */
function functionId(name: string): string {
  return `chronicle-${name}`;
}

/**
 * Deterministic dedupe key for at-least-once event delivery. Two calls with identical payload
 * (post-canonical-stringify) produce the same id, so Inngest collapses them into one run within
 * its **24-hour** send-side dedupe window. Re-enqueues 24h+ apart can run twice; that's
 * acceptable because pipeline handlers are idempotent at the story-state layer. Property
 * ordering inside a `JobPayload` is contract-stable today (`{ storyId: string }`), but if a
 * future stage adds keys we keep this hash semantically meaningful by sorting keys before
 * stringifying.
 */
function dedupeId(name: JobName, payload: JobPayload): string {
  const canonical = canonicalJson(payload);
  return createHash("sha256").update(`${name}:${canonical}`).digest("hex");
}

/**
 * Exported for tests pinning the key-sort invariant. Not part of the public adapter contract —
 * callers should not depend on it.
 * @internal
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}
