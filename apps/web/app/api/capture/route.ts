/**
 * Capture intake endpoint. Receives the narrator's session token + the wideband audio blob and runs
 * the source-agnostic ingest: persist the immutable audio FIRST, then create the draft Story.
 * Errors return a non-OK status but carry NO troubleshooting detail to the narrator — the client
 * shows warm copy and the failure is surfaced to the family elsewhere.
 *
 * Auth model (intentional — NOT an oversight): there is deliberately no `getCurrentAuthContext()`
 * here. On the narrator surface the session token IS the identity; it is the only credential, and it
 * is validated INSIDE the domain (`ingestRecording` → `resolveLinkSession`), which fails with
 * `InvalidSessionError` (→ 401) on a bad/expired/revoked token. The account-cookie auth used by the
 * hub routes does not apply to this login-free surface.
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
  const askIdField = form.get("askId");
  if (typeof token !== "string" || !(audio instanceof Blob)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Optional askId pairs the recording with the relay (the narrator is answering a family
  // member's question). The approval write later flips the Ask to `answered` atomically.
  const askId = typeof askIdField === "string" && askIdField !== "" ? askIdField : undefined;

  try {
    const result = await ingestRecording(db, storage, {
      actor: { kind: "link_session", token },
      source: "web_link",
      audio: {
        bytes,
        contentType: audio.type || "audio/webm",
      },
      ...(askId !== undefined ? { askId } : {}),
    });
    return NextResponse.json({ ok: true, storyId: result.storyId });
  } catch (err) {
    if (err instanceof InvalidSessionError) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
