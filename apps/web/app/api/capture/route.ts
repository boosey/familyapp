/**
 * Capture intake endpoint. Receives the elder's session token + the wideband audio blob and runs
 * the source-agnostic ingest: persist the immutable audio FIRST, then create the draft Story.
 * Errors return a non-OK status but carry NO troubleshooting detail to the elder — the client
 * shows warm copy and the failure is surfaced to the family elsewhere.
 */
import { ingestRecording, InvalidSessionError } from "@chronicle/capture";
import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const { db, storage } = await getRuntime();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const token = form.get("token");
  const audio = form.get("audio");
  if (typeof token !== "string" || !(audio instanceof Blob)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const result = await ingestRecording(db, storage, {
      sessionToken: token,
      source: "web_link",
      audio: {
        bytes,
        contentType: audio.type || "audio/webm",
      },
    });
    return NextResponse.json({ ok: true, storyId: result.storyId });
  } catch (err) {
    if (err instanceof InvalidSessionError) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
