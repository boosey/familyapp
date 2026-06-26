/**
 * Authorized media playback. The Media bytes live in object storage; this route is the ONLY web
 * surface that returns them, and every byte goes through `getMediaForViewer` (the single front
 * door) first. A miss returns 404 with no detail — never reveals whether a key exists.
 *
 * The hub plays a story by referencing `/api/media/{recordingMediaId}` — the route resolves the
 * viewer's AuthContext, asks core if they may read this Media, and only then streams the bytes.
 */
import { NextResponse } from "next/server";
import { getMediaForViewer } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  const m = await getMediaForViewer(db, ctx, id);
  if (!m) {
    // Indistinguishable from "media does not exist" — no leak about whether a key is present.
    return new NextResponse(null, { status: 404 });
  }

  const bytes = await storage.getBytes(m.storageKey);
  if (!bytes) return new NextResponse(null, { status: 404 });

  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": m.contentType,
      "Content-Length": String(bytes.byteLength),
      // Audio is the canonical artifact and is immutable in storage — safe to cache aggressively
      // by content-addressed Media id. The auth check still runs on every request because the
      // browser sends the cookie; this header just lets a logged-in viewer scrub without re-fetch.
      "Cache-Control": "private, max-age=300",
    },
  });
}
