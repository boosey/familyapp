/**
 * Authorized album-photo bytes (ADR-0009 · #15). The album photo bytes live in object storage; this
 * route is the ONLY web surface that returns them, and every byte goes through the album front door
 * (`getAlbumPhotoForViewer`, which runs `authorizeAlbumPhotoRead`) first. A miss returns 404 with no
 * detail — never reveals whether a photo id exists or is merely off-limits. Mirrors /api/media/[id].
 *
 * A viewer may read the bytes iff they hold an ACTIVE membership in ANY family the (non-deleted)
 * photo is placed in — so a photo shared into two families is legible to members of either.
 */
import { NextResponse } from "next/server";
import { getAlbumPhotoForViewer } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ photoId: string }> },
): Promise<Response> {
  const { photoId } = await params;
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  const photo = await getAlbumPhotoForViewer(db, ctx, photoId);
  if (!photo) {
    // Indistinguishable from "photo does not exist" — no leak about whether a key is present.
    return new NextResponse(null, { status: 404 });
  }

  const bytes = await storage.getBytes(photo.storageKey);
  if (!bytes) return new NextResponse(null, { status: 404 });

  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      // The album row is lean (ADR-0009 stores no content-type); sniff it from the magic bytes so
      // the browser renders the tile inline.
      "Content-Type": sniffImageContentType(bytes),
      "Content-Length": String(bytes.byteLength),
      // Photo bytes are write-once in storage (immutable key) — safe to cache privately. The auth
      // check still runs on every request (the browser sends the cookie); this only saves re-fetch.
      "Cache-Control": "private, max-age=300",
    },
  });
}
