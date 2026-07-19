/**
 * Orphaned-object reaper (issue #90).
 *
 * The album upload path is put-then-record: the browser PUTs bytes to `family-photos/<uuid>`
 * BEFORE the server records the `family_photos` row. Any interruption between the two (user
 * abandons, record fails for a non-create reason) leaves a write-once object with no DB row and
 * no cleanup — and #20's per-file retry mints a FRESH key each attempt, so a flaky uplink can
 * accumulate several. This sweep reconciles the keyspace against `family_photos.storage_key`:
 *
 *   - every object under `family-photos/` OLDER than the safety window (default 1h — an upload +
 *     record completes in seconds, so nothing older can still be in flight) with no matching row
 *     is hard-deleted;
 *   - a `.thumb` derivative has no row BY DESIGN (its key is derived from the original's), so it
 *     is referenced iff its BASE key (suffix stripped) has a row — a live photo's thumbnail is
 *     kept, an orphan's thumbnail is reaped with it;
 *   - soft-deleted rows still count as references: their bytes are deliberately retained today,
 *     so the reaper must not destroy them;
 *   - idempotent by construction (the keyspace is write-once and `delete` is an idempotent
 *     hard-delete) and safe against concurrent uploads (the age window, plus a delete can't
 *     clobber a live object mid-write because nothing ever rewrites a key).
 *
 * It runs as a scheduled job (Inngest cron, registered in apps/web/lib/runtime.ts), NOT on the
 * request path, and returns its counts for observability. One failing delete does not abort the
 * sweep: the key is logged and left for the next run rather than letting a single poison object
 * block all reaping forever.
 */
import { listAlbumPhotoStorageKeys } from "@chronicle/core/pipeline";
import type { Database } from "@chronicle/db";
import {
  ALBUM_PHOTO_KEY_PREFIX,
  THUMBNAIL_KEY_SUFFIX,
  type MediaStorage,
} from "@chronicle/storage";
import { errMsg, plog, plogError } from "./logger";

/**
 * How old an unreferenced object must be before the reaper touches it. The direct-upload ticket
 * lives 10 minutes (UPLOAD_TARGET_EXPIRY_SECONDS) and record runs immediately after the PUT, so
 * 1h is far beyond any legitimate in-flight upload — the window exists so the sweep can never
 * race one.
 */
export const REAP_MIN_AGE_MS = 60 * 60 * 1000;

export interface ReapOrphanedPhotosDeps {
  db: Database;
  storage: MediaStorage;
  /** Injectable clock (tests). Defaults to wall time. */
  now?: () => Date;
  /** Safety window override (tests / ops). Defaults to REAP_MIN_AGE_MS. */
  minAgeMs?: number;
}

export interface ReapOrphanedPhotosResult {
  /** Objects found under the album prefix (referenced and orphaned alike). */
  scanned: number;
  /** Objects hard-deleted this run. */
  reaped: number;
  /** Objects whose delete failed (left in place for the next run). */
  failed: number;
}

export async function reapOrphanedPhotos({
  db,
  storage,
  now = () => new Date(),
  minAgeMs = REAP_MIN_AGE_MS,
}: ReapOrphanedPhotosDeps): Promise<ReapOrphanedPhotosResult> {
  const cutoffMs = now().getTime() - minAgeMs;
  const referenced = new Set(await listAlbumPhotoStorageKeys(db));
  const objects = await storage.list({ prefix: ALBUM_PHOTO_KEY_PREFIX });

  let reaped = 0;
  let failed = 0;
  for (const obj of objects) {
    if (obj.lastModified.getTime() > cutoffMs) continue; // inside the safety window
    const isOrphan = obj.key.endsWith(THUMBNAIL_KEY_SUFFIX)
      ? !referenced.has(obj.key.slice(0, -THUMBNAIL_KEY_SUFFIX.length))
      : !referenced.has(obj.key);
    if (!isOrphan) continue;
    try {
      await storage.delete(obj.key);
      reaped += 1;
    } catch (err) {
      failed += 1;
      plogError("reap", "delete failed — leaving the object for the next run", {
        key: obj.key,
        err: errMsg(err),
      });
    }
  }

  const result: ReapOrphanedPhotosResult = { scanned: objects.length, reaped, failed };
  plog("reap", "orphaned album-object sweep complete", { ...result });
  return result;
}
