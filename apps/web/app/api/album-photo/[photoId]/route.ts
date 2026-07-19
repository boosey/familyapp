/**
 * Authorized album-photo bytes (ADR-0009 · #15 · #139 thumbnails). The album photo bytes live in object
 * storage; this route is the ONLY web surface that returns them, and every byte goes through the album
 * front door (`getAlbumPhotoForViewer`, which runs `authorizeAlbumPhotoRead`) first. A miss returns 404
 * with no detail — never reveals whether a photo id exists or is merely off-limits. Mirrors /api/media/[id].
 *
 * A viewer may read the bytes iff they hold an ACTIVE membership in ANY family the (non-deleted)
 * photo is placed in — so a photo shared into two families is legible to members of either.
 *
 * `?variant=thumb` (issue #139) serves a downscaled JPEG thumbnail instead of the full-resolution
 * original — for the album grid/list, which otherwise ship multi-MB photos the browser scales to a
 * ~140px tile. The thumbnail is generated lazily by `sharp` on first request and cached in the same
 * storage (so existing photos are backfilled with no separate script), then served on later requests.
 * CRUCIALLY the variant is chosen ONLY AFTER the front-door authorization above — the thumbnail path
 * enforces the exact same gate as full-res; an unauthorized viewer 404s either way.
 */
import { NextResponse } from "next/server";
import { getAlbumPhotoForViewer } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { ALBUM_PHOTO_THUMB_VARIANT, ALBUM_PHOTO_VARIANT_PARAM } from "@/app/hub/album/photo-src";
import { thumbnailStorageKey, warmThumbnail, THUMBNAIL_CONTENT_TYPE } from "@/lib/thumbnail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Best-effort image content-type from the leading magic bytes. The lean album row (ADR-0009) does
 * not store a content-type, so we sniff enough to make the browser render the tile; anything
 * unrecognized falls back to a generic binary type (still fetchable, just not guaranteed inline).
 */
function sniffImageContentType(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

/** Private, short-lived cache — the auth check still runs on every request (the browser sends the
 *  cookie); this only saves a re-fetch of write-once bytes. Shared by both variants. */
function byteResponse(bytes: Uint8Array, contentType: string): NextResponse {
  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ photoId: string }> },
): Promise<Response> {
  const { photoId } = await params;
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  // Front door FIRST — authorization is identical for full-res and thumbnail; the variant only
  // decides which bytes an already-authorized viewer receives.
  const photo = await getAlbumPhotoForViewer(db, ctx, photoId);
  if (!photo) {
    // Indistinguishable from "photo does not exist" — no leak about whether a key is present.
    return new NextResponse(null, { status: 404 });
  }

  const wantThumb =
    new URL(request.url).searchParams.get(ALBUM_PHOTO_VARIANT_PARAM) === ALBUM_PHOTO_THUMB_VARIANT;

  if (wantThumb) {
    // Fast path: serve the cached thumbnail if it already exists (new uploads warm it at record time;
    // this also serves it on every request after the first lazy generation).
    const thumbKey = thumbnailStorageKey(photo.storageKey);
    const cached = await storage.getBytes(thumbKey);
    if (cached) {
      if (cached.byteLength === 0) {
        // Failure sentinel (issue #176): generation already failed for these bytes — do NOT re-run
        // `sharp`. Degrade straight to the full-res original, sniffed, exactly like the first time.
        const original = await storage.getBytes(photo.storageKey);
        if (!original) return new NextResponse(null, { status: 404 });
        return byteResponse(original, sniffImageContentType(original));
      }
      return byteResponse(cached, THUMBNAIL_CONTENT_TYPE);
    }

    // Lazy generation (BACKFILL): a photo predating this feature (or one whose warm raced a store
    // error before the sentinel existed) gets its thumbnail made here on first grid request and
    // cached for next time. A warm that failed post-#176 left a sentinel, handled above.
    const original = await storage.getBytes(photo.storageKey);
    if (!original) return new NextResponse(null, { status: 404 });
    const thumb = await warmThumbnail(storage, photo.storageKey, original);
    if (thumb) return byteResponse(thumb, THUMBNAIL_CONTENT_TYPE);
    // sharp could not decode the bytes (non-image / corrupt): degrade to the full-res original,
    // sniffed — the tile still renders rather than breaking, and `warmThumbnail` has now cached
    // the failure as a sentinel so this regeneration never happens again.
    return byteResponse(original, sniffImageContentType(original));
  }

  const bytes = await storage.getBytes(photo.storageKey);
  if (!bytes) return new NextResponse(null, { status: 404 });

  // The album row is lean (ADR-0009 stores no content-type); sniff it from the magic bytes so the
  // browser renders the tile inline.
  return byteResponse(bytes, sniffImageContentType(bytes));
}
