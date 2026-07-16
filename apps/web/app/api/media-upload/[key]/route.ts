/**
 * Dev-only direct-upload receiver (issue #20).
 *
 * In production the browser PUTs album photo bytes to a PRESIGNED R2 URL that points at R2 — never at
 * this route. This route exists ONLY so `next dev` (filesystem/in-memory storage, which can't presign)
 * exercises the EXACT same request→PUT→record shape as prod. It therefore 404s in any durable/Vercel
 * deploy: there is no legitimate caller for it there, and it must never become a second, un-presigned
 * byte-write surface on the single front door.
 *
 * Even in dev it re-enforces every server-side rule the presign would enforce for R2:
 *   - an authenticated session (identity is never trusted from the client), AND
 *   - a valid HMAC upload ticket bound to THIS person + THIS key (unexpired, minter === caller), AND
 *   - the `family-photos/` keyspace, AND
 *   - write-once — a key that already has an object 409s (mirrors R2's `If-None-Match: "*"`).
 * The dynamic `[key]` segment carries the storage key URL-encoded as a SINGLE segment (the key itself
 * contains a slash); we decode it back.
 */
import { NextResponse } from "next/server";
import { ObjectAlreadyExistsError, isAllowedImageContentType } from "@chronicle/storage";
import { getRuntime, isDurableDeploy } from "@/lib/runtime";
import { verifyUploadTicket } from "@/lib/upload-ticket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALBUM_PHOTO_KEY_PREFIX = "family-photos/";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  // Hard 404 anywhere durable — R2 presign URLs never point here, so a hit in prod is illegitimate.
  if (isDurableDeploy()) return new NextResponse(null, { status: 404 });

  const { key: rawKey } = await params;
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const { storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return new NextResponse(null, { status: 401 });

  const ticket = request.headers.get("x-upload-ticket");
  const verified = ticket ? verifyUploadTicket(ticket) : null;
  if (!verified || verified.personId !== ctx.personId || verified.key !== key) {
    return new NextResponse(null, { status: 403 });
  }
  if (!key.startsWith(ALBUM_PHOTO_KEY_PREFIX)) {
    return new NextResponse(null, { status: 403 });
  }

  // Content-type parity with prod: `requestAlbumUploadAction` validates the type before presigning
  // (and the R2 presign binds it), so the dev receiver must reject a non-image here too — 415.
  const contentType = request.headers.get("content-type") || "application/octet-stream";
  if (!isAllowedImageContentType(contentType)) {
    return new NextResponse(null, { status: 415 });
  }

  // Write-once: reject if an object already lives at this key (mirrors R2's If-None-Match: "*").
  if (await storage.exists(key)) {
    return new NextResponse(null, { status: 409 });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return new NextResponse(null, { status: 400 });

  try {
    await storage.put({ key, bytes, contentType });
  } catch (err) {
    // A race that lost the write-once check still surfaces as a conflict, not a 500.
    if (err instanceof ObjectAlreadyExistsError) {
      return new NextResponse(null, { status: 409 });
    }
    throw err;
  }

  return new NextResponse(null, { status: 200 });
}
