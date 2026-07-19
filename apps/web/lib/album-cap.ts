/**
 * Defensive album-cap helpers for the loop-all-families photo pickers (issue #217).
 *
 * Each per-family `listAlbumPhotos` read is already DB-capped at `ALBUM_PHOTO_QUERY_CAP`, but a
 * picker that unions several families' albums (deduped) can still exceed the ceiling before anything
 * crosses to the browser. `capAlbumUnion` bounds that union to the SAME ceiling, keeping the
 * most-recent rows. `warnAlbumCapHit` drops one greppable breadcrumb when the cap actually trips —
 * unlike `plog`/`clog` (both silenced in production) a bare `console.warn` reaches the Vercel
 * function logs, which is the only telemetry sink this app has today.
 *
 * These are the (a)-scope safety net; real pagination / server-side filtering / virtualization are
 * the follow-ups (#218, #219) that will retire the "keep most-recent N" behavior.
 */
import { ALBUM_PHOTO_QUERY_CAP } from "@chronicle/core";

/**
 * Bound a deduped photo union to `cap` most-recent rows. A NO-OP whenever the union is at/under the
 * cap — the input order is preserved untouched (so today's pickers behave exactly as before). Only
 * when the union OVERFLOWS does it sort by `createdAt` (newest first) and drop the tail.
 */
export function capAlbumUnion<T extends { createdAt: Date }>(
  rows: readonly T[],
  cap: number = ALBUM_PHOTO_QUERY_CAP,
): { rows: T[]; capped: boolean } {
  if (rows.length <= cap) return { rows: [...rows], capped: false };
  const byRecency = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { rows: byRecency.slice(0, cap), capped: true };
}

/** One greppable breadcrumb when an album read hits the defensive cap. Reaches Vercel function logs. */
export function warnAlbumCapHit(surface: string, cap: number, loaded: number): void {
  // eslint-disable-next-line no-console
  console.warn(`[album:cap] surface=${surface} cap=${cap} loaded=${loaded} truncated — see #217`);
}
