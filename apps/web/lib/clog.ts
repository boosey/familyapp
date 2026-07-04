/**
 * Client-side capture-state observability for the composing flow (ADR-0014 Inc 5). The mirror of the
 * server `plog` facility (`@chronicle/pipeline/logger`), but for the browser: a single line per
 * capture-state transition (record start/stop, take appended, follow-up proposed, polish, finish,
 * share) so a live session can be followed from the devtools console alongside the correlated server
 * logs. NON-sensitive by contract — log ids/kinds/booleans/lengths only, never prose text.
 *
 * QUIET BY DEFAULT. Two independent toggles enable it:
 *   NEXT_PUBLIC_CHRONICLE_CLIENT_LOG=1   build-time env flag (read ONCE at module load).
 *   localStorage["chronicle:clog"] = "1" devtools flag (read at EVERY call, so it can be flipped in a
 *                                        prod console without a reload). SSR-safe: guarded on `window`
 *                                        and wrapped in try/catch (localStorage can throw).
 * When neither is set, `clog` early-returns before doing any work.
 */

type Field = string | number | boolean | null | undefined;

/** Env flag is fixed for the life of the bundle — read it once. */
const ENV_ENABLED = process.env["NEXT_PUBLIC_CHRONICLE_CLIENT_LOG"] === "1";

/** Read the devtools localStorage flag at call time. SSR-safe; localStorage access can throw. */
function localStorageEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem("chronicle:clog") === "1";
  } catch {
    return false;
  }
}

/** Render `{k: v}` fields as ` k=v` pairs; quote values with whitespace; drop undefineds (mirrors `fmt`). */
function fmt(fields: Record<string, Field>): string {
  const tail = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "string" && /\s/.test(v) ? JSON.stringify(v) : v}`)
    .join(" ");
  return tail ? ` ${tail}` : "";
}

/**
 * Log one client capture-state transition. Fire-and-forget: never throws, never affects control flow.
 * A no-op (cheap early return) unless one of the two toggles is enabled.
 */
export function clog(event: string, fields: Record<string, Field> = {}): void {
  if (!ENV_ENABLED && !localStorageEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[chronicle:client] ${event}${fmt(fields)}`);
}
