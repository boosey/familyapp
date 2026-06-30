/**
 * Capture intake endpoint. Receives the narrator's session token + the wideband audio blob, runs
 * the source-agnostic ingest (persist audio → create draft Story), then runs the render pipeline
 * (transcribe → polish) so the story reaches `pending_approval` before the narrator lands on the
 * approve page. Errors return a non-OK status but carry NO troubleshooting detail to the narrator —
 * the client shows warm copy and the failure is surfaced to the family elsewhere.
 *
 * Auth model (intentional — NOT an oversight): there is deliberately no `getCurrentAuthContext()`
 * here. On the narrator surface the session token IS the identity; it is the only credential, and
 * it is validated INSIDE the domain (`ingestRecording` → `resolveLinkSession`), which fails with
 * `InvalidSessionError` (→ 401) on a bad/expired/revoked token. The account-cookie auth used by
 * the hub routes does not apply to this login-free surface.
 */
import { ingestRecording, InvalidSessionError } from "@chronicle/capture";
import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const { db, storage, newPipeline } = await getRuntime();

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

  let storyId: string;
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
    storyId = result.storyId;
  } catch (err) {
    if (err instanceof InvalidSessionError) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // Render BEFORE review (prose-provenance design): transcribe → polish so the approve page can
  // show L2 prose for the narrator to read and edit. Mirrors the in-hub recordAnswerAction.
  // A fresh pipeline per call isolates its in-process queue. Pipeline stages are idempotent, so
  // a retry of this endpoint on an already-rendered story is a no-op — safe to retry on soft-fail.
  try {
    const pipeline = newPipeline();
    await pipeline.start(storyId);
    await pipeline.runToCompletion();
  } catch (err) {
    // Server-side breadcrumb only: this login-free surface has no other error-reporting path, so a
    // silent 500 would make render failures invisible to ops. Detail is NEVER returned to the
    // client (the response below carries none). Matches the augmentation catch in shareAnswerAction.
    // eslint-disable-next-line no-console
    console.error("capture: render pipeline failed after ingest (story=%s):", storyId, err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true, storyId });
}
