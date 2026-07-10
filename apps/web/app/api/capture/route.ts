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
import { ingestRecording, InvalidSessionError, resolveLinkSession } from "@chronicle/capture";
import { beginLogContext, plog, plogError, startTimer } from "@chronicle/pipeline";
import { NextResponse } from "next/server";
import { assertAnswerableAsk } from "@/lib/answerable-ask";
import { getRuntime } from "@/lib/runtime";
import { resolveSubjectPhotos, attachCarryForwardPhotos } from "@/lib/subject-photo";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  // Bind a correlation id to this request so every downstream log line (ingest → queue → stages →
  // AI seams) shares one greppable tag. Must run before the first plog below.
  beginLogContext();
  const rt = await getRuntime();
  const { db, storage } = rt;

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

  // ADR-0009 Phase 3: when answering an ask that has subject photos, the FIRST becomes the story's
  // subject/cover (threaded into ingest) and the REST ride as accompaniment after ingest. Link-
  // session has no client tell-a-photo hint (null). Resolve the narrator personId up front so
  // carry-forward attach can run after ingest without extending IngestResult.
  //
  // IDOR guard: resolve the link session FIRST, then assert the ask is targeted at that narrator
  // and still answerable (queued/routed) — same rules as the hub's assertAnswerableAsk — BEFORE
  // resolveSubjectPhotos / ingest. Otherwise a valid token for Person A could bind Person B's ask
  // (and its subject photos) onto A's story.
  let subjectPhotoId: string | undefined;
  let carryForward: string[] = [];
  let narratorPersonId: string | undefined;
  if (askId) {
    const session = await resolveLinkSession(db, token);
    if (!session) {
      plogError("capture", "POST /api/capture: invalid session before ingest (401)");
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    narratorPersonId = session.personId;

    const ask = await assertAnswerableAsk(db, askId, session.personId);
    if (!ask.ok) {
      plogError("capture", "POST /api/capture: ask not answerable for session narrator (403)", {
        reason: ask.reason,
      });
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    const photos = await resolveSubjectPhotos(db, askId, null);
    subjectPhotoId = photos.subjectPhotoId;
    carryForward = photos.carryForward;
  }

  const totalTimer = startTimer();
  plog("capture", "POST /api/capture: received (link_session)", {
    bytes: bytes.byteLength,
    contentType: audio.type || "audio/webm",
    askId,
  });

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
      ...(subjectPhotoId ? { subjectPhotoId } : {}),
    });
    storyId = result.storyId;
  } catch (err) {
    if (err instanceof InvalidSessionError) {
      plogError("capture", "POST /api/capture: invalid session (401)", { ms: totalTimer() });
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    plogError("capture", "POST /api/capture: ingest failed (500)", {
      ms: totalTimer(),
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  plog("capture", "POST /api/capture: ingested → draft story created", { story: storyId });

  // Answer→story carry-forward (ADR-0009 Phase 3): remaining ask subject photos as accompaniment.
  // Best-effort — never blocks capture. narratorPersonId is set whenever askId was present.
  if (narratorPersonId && carryForward.length > 0) {
    await attachCarryForwardPhotos(db, storyId, carryForward, narratorPersonId);
  }

  // Render BEFORE review (prose-provenance design): transcribe → polish so the approve page can
  // show L2 prose for the narrator to read and edit. Mirrors the in-hub recordAnswerAction.
  // dispatchPipeline hides the durable-vs-synchronous decision: in dev/CI it runs the in-process
  // pipeline to completion in-request (story reaches pending_approval before this returns); in prod
  // it enqueues onto the durable Inngest queue and returns. Pipeline stages are idempotent, so a
  // retry of this endpoint on an already-rendered story is a no-op — safe to retry on soft-fail.
  try {
    await rt.dispatchPipeline(storyId);
  } catch (err) {
    // Server-side breadcrumb only: this login-free surface has no other error-reporting path, so a
    // silent 500 would make render failures invisible to ops. Detail is NEVER returned to the
    // client (the response below carries none). Matches the augmentation catch in shareAnswerAction.
    plogError("capture", "POST /api/capture: render pipeline failed after ingest (500)", {
      story: storyId,
      ms: totalTimer(),
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  plog("capture", "POST /api/capture: complete (story pending_approval)", {
    story: storyId,
    ms: totalTimer(),
  });
  return NextResponse.json({ ok: true, storyId });
}
