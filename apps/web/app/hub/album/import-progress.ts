/**
 * Shared contract for the in-grid per-item import progress feature (ADR-0015 · F2).
 *
 * These are the load-bearing types the client wrapper (`AlbumBoard`), the grid (`AlbumGrid`), and the
 * per-item server actions agree on. Kept in one client-safe module (no `"use server"`, no `server-only`,
 * no DB) so both the client components and the action files can import the shapes without pulling a
 * server-only dependency into the client bundle.
 *
 * Design (ADR-0015): the client drives import as ONE server-action call per photo through a bounded
 * concurrency pool, so each placeholder tile resolves — or fails with tap-to-retry — independently, and
 * the UI shows a live "X of N". Google is split into a list-first step (exact-N handles) followed by
 * per-item download+create, matching file upload's exact-N placeholder UX.
 */

import { PHOTO_BATCH_MAX_FILES } from "@/lib/constants";

/**
 * A placeholder tile shown at the TOP of the album grid while its photo is being imported. This is the
 * ONLY per-item shape the grid needs — the retry work item (a File or a Google handle) is held by the
 * board, keyed by `tempId`, and never handed to the grid. The grid asks the board to retry via a
 * callback; it never carries credentials or bytes.
 */
export interface PendingTile {
  /** Stable client-generated key (one per selected photo). Never a server id. */
  tempId: string;
  status: PendingTileStatus;
  /** The created photo's server id — present ONLY once `status === "loaded"`. The grid renders the
   *  real bytes optimistically from this id so the tile never blanks between spinner and photo. */
  photoId?: string;
}

export type PendingTileStatus =
  /** In flight (downloading/uploading + creating the row) — show a quiet spinner. */
  | "importing"
  /** Row created: the tile immediately shows the real photo (by `photoId`) WITHOUT waiting on the
   *  server refresh, so it never blanks. A later `router.refresh()` reconciles it into a real grid
   *  tile and the board drops the loaded placeholder once the server list carries the id. */
  | "loaded"
  /** This item failed; the tile shows a tap-to-retry affordance. Others are unaffected. */
  | "failed";

/**
 * A token-gated, client-facing handle for one picked Google photo (ADR-0015 Consequences). `baseUrl`
 * is useless without the server-held access token, so passing it to the client — and back to the
 * per-item action — is NOT a credential leak; it avoids N re-`list` calls. Mirrors the picker's
 * `PickedPhoto` shape but is the deliberate client contract.
 */
export interface GooglePhotoImportHandle {
  id: string;
  mimeType: string;
  filename: string | null;
  /** Google Picker `mediaFile.baseUrl`. Token-gated; not a credential. */
  baseUrl: string;
}

/**
 * Result of the list-first Google step: the picked count + per-item handles, so the client can render
 * exactly N placeholder tiles before any download begins. `skipped`/`rejected` mirror the existing
 * batch action's accounting (videos skipped; malformed items rejected).
 */
export type ListGooglePhotosImportResult =
  | {
      ok: true;
      count: number;
      items: GooglePhotoImportHandle[];
      skipped: number;
      rejected: number;
    }
  | { error: string };

/** Result of importing ONE photo (upload OR one Google handle): the created photo's id on success (so
 *  the client can render its tile optimistically), or a user-facing error. */
export type ImportOnePhotoResult = { ok: true; photoId: string } | { error: string };

/**
 * The most photos the client will send to the per-item pool in one batch. Still enforced client-side as
 * a UX/resource guard (ADR-0015): the per-item action re-resolves auth and re-validates family
 * membership server-side, so the cap is NOT a security boundary. Single source of truth:
 * PHOTO_BATCH_MAX_FILES (the same value the server action enforces).
 */
export const MAX_IMPORT_BATCH = PHOTO_BATCH_MAX_FILES;

/** How many per-item imports run concurrently through the pool (ADR-0015 caps the burst). */
export const IMPORT_POOL_CONCURRENCY = 3;
