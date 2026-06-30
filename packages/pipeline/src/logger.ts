/**
 * Dev-time observability for the answer pipeline + AI seams.
 *
 * Profuse by design: every pipeline stage transition and every AI call (transcribe / LLM
 * `complete`) emits a line, so a live-AI run can be followed end to end from the dev console.
 *
 * PRIVACY — story transcripts and rendered prose are sensitive family content. By default we log
 * SIZES and a short truncated PREVIEW only, and the whole facility is OFF in production and under
 * tests. Knobs (all read once at module load):
 *   CHRONICLE_PIPELINE_LOG=0       force off (even in dev)
 *   CHRONICLE_PIPELINE_LOG=1       force on (even in prod / tests — use deliberately)
 *   CHRONICLE_PIPELINE_LOG_FULL=1  log FULL transcript/prose instead of a truncated preview
 *
 * CORRELATION — one answer-pipeline run threads through a request entrypoint, the in-process
 * job queue, the stages, and the AI-seam wrappers, all in the same async subtree. An
 * AsyncLocalStorage carries a short correlation id across that subtree so every line for one run
 * shares a tag (`[chronicle:pipeline:ab12cd34] …`) and is greppable as a unit — without
 * threading an id parameter through every function signature. Entrypoints call `beginLogContext`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const FORCED = process.env["CHRONICLE_PIPELINE_LOG"];

interface LogContext {
  cid: string;
}
const logContext = new AsyncLocalStorage<LogContext>();

/** A short, human-scannable run id. Uniqueness only needs to hold within a session's logs. */
export function newCorrelationId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * Bind a correlation id to the CURRENT async execution and everything it awaits. Use this at a
 * request entrypoint (route handler / server action) — `enterWith` (vs `run`) avoids wrapping the
 * whole handler body in a callback, which keeps existing control flow (early returns, the
 * redirect-outside-try in shareAnswerAction) untouched. Each entrypoint invocation is its own
 * async chain, so the binding is request-scoped. Returns the id (defaults to a fresh one).
 */
export function beginLogContext(cid: string = newCorrelationId()): string {
  logContext.enterWith({ cid });
  return cid;
}

/** Run `fn` with a correlation id bound to its async subtree (callback form of beginLogContext). */
export function withLogContext<T>(cid: string, fn: () => T): T {
  return logContext.run({ cid }, fn);
}

/**
 * Enabled in local dev by default; suppressed under Vitest (so the suite stays quiet) and in
 * production (so family-story content never lands in prod logs). Either bound can be overridden
 * explicitly via CHRONICLE_PIPELINE_LOG.
 */
export const pipelineLogEnabled: boolean =
  FORCED === "1"
    ? true
    : FORCED === "0"
      ? false
      : process.env["NODE_ENV"] !== "production" && !process.env["VITEST"];

const LOG_FULL = process.env["CHRONICLE_PIPELINE_LOG_FULL"] === "1";

type Field = string | number | boolean | null | undefined;

/** Render `{k: v}` fields as `k=v` pairs; quote values containing whitespace; drop undefineds. */
function fmt(fields: Record<string, Field>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "string" && /\s/.test(v) ? JSON.stringify(v) : v}`)
    .join(" ");
}

/** `scope` plus the current correlation id (if any), e.g. `pipeline:ab12cd34`. */
function tag(scope: string): string {
  const cid = logContext.getStore()?.cid;
  return cid ? `${scope}:${cid}` : scope;
}

export function plog(scope: string, msg: string, fields: Record<string, Field> = {}): void {
  if (!pipelineLogEnabled) return;
  const tail = fmt(fields);
  // eslint-disable-next-line no-console
  console.info(`[chronicle:${tag(scope)}] ${msg}${tail ? ` ${tail}` : ""}`);
}

export function plogError(scope: string, msg: string, fields: Record<string, Field> = {}): void {
  if (!pipelineLogEnabled) return;
  const tail = fmt(fields);
  // eslint-disable-next-line no-console
  console.error(`[chronicle:${tag(scope)}] ${msg}${tail ? ` ${tail}` : ""}`);
}

/**
 * Truncated preview of sensitive text (full content only when CHRONICLE_PIPELINE_LOG_FULL=1).
 * Newlines are collapsed so a multi-line transcript stays on one log line.
 */
export function preview(text: string, max = 280): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (LOG_FULL || oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…(+${oneLine.length - max} chars)`;
}

/** Normalize an unknown thrown value to a compact one-line string for logging. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** Elapsed-time helper. Returns a fn giving whole ms since creation. */
export function startTimer(): () => number {
  const t0 = performance.now();
  return () => Math.round(performance.now() - t0);
}
