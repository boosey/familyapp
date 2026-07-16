/**
 * Client-side direct-to-storage upload for one album photo (issue #20).
 *
 * The three-step flow, driven from the browser:
 *   1. `requestAlbumUploadAction({ contentType })` — the server mints a fresh key, a direct-upload
 *      target (presigned PUT on R2 / dev-receiver URL locally), and an HMAC ticket.
 *   2. PUT the bytes straight to `upload.url` with EXACTLY `upload.headers` (+ the ticket header, which
 *      R2 ignores and the dev receiver validates). The bytes never touch a Server Action.
 *   3. `recordAlbumPhotoAction({ key, familyIds, ticket })` — the server verifies the ticket, confirms
 *      the object exists, EXIFs the stored bytes, and creates the row.
 *
 * Returns the same `ImportOnePhotoResult` the pool already consumes, so the board's per-item settle
 * logic is unchanged — only the work INSIDE one item moved from "one action" to "request → PUT → record".
 */
"use client";

import { requestAlbumUploadAction, recordAlbumPhotoAction } from "./actions";
import { hub } from "@/app/_copy";
import type { ImportOnePhotoResult } from "./import-progress";

/** The ticket header name the dev receiver reads (R2 ignores unknown headers on a presigned PUT). */
const UPLOAD_TICKET_HEADER = "x-upload-ticket";

/**
 * Upload one already-prepared File directly to storage, then record its album row. `file` is assumed
 * to have passed `prepareAlbumPhoto` (downscaled + a canvas-safe image type). Never throws — a network
 * or server failure collapses to an `{ error }` the pool renders as a retryable failed tile.
 */
export async function uploadPhotoDirect(
  file: File,
  familyIds: string[],
): Promise<ImportOnePhotoResult> {
  const contentType = file.type || "application/octet-stream";

  // 1. Request a target + ticket.
  let requested;
  try {
    requested = await requestAlbumUploadAction({ contentType });
  } catch {
    return { error: hub.album.uploadError };
  }
  if ("error" in requested) return { error: requested.error };

  // 2. PUT the bytes straight to storage.
  try {
    const res = await fetch(requested.upload.url, {
      method: requested.upload.method,
      headers: {
        ...requested.upload.headers,
        [UPLOAD_TICKET_HEADER]: requested.ticket,
      },
      body: file,
    });
    if (!res.ok) return { error: hub.album.uploadError };
  } catch {
    return { error: hub.album.uploadError };
  }

  // 3. Record the row (server re-validates the ticket, family membership, and object existence).
  const fd = new FormData();
  fd.append("key", requested.key);
  fd.append("ticket", requested.ticket);
  for (const id of familyIds) fd.append("familyIds", id);
  try {
    return await recordAlbumPhotoAction(fd);
  } catch {
    return { error: hub.album.uploadError };
  }
}
