/**
 * Narrator-initiated retry of a FAILED story pipeline (issue #11).
 *
 * When a durable-job stage (transcribe / render_story) exhausts its retries, the story is marked
 * failed (`processingFailedAt`) and the approve surface shows a "try again" affordance instead of
 * spinning forever. This endpoint is what that affordance calls: it clears the failure marker, bumps
 * the retry generation (the dedupe-bust token the durable queue needs to actually re-fire), and
 * re-dispatches the pipeline from the first stage. The stages are idempotent, so re-running a
 * partially-completed pipeline (e.g. transcript exists, render failed) skips the finished work.
 *
 * Auth model — identical to /api/capture and /api/capture/status: the session token IS the identity.
 * The token resolves to the narrator's Person id; the story is read through the SINGLE FRONT DOOR and
 * we pin ownership, so a wrong/expired token (401) or a story the narrator doesn't own (404) leaks
 * nothing. Only a genuinely-failed draft is retryable (409 otherwise) so a stray click cannot burn a
 * redundant vendor run.
 */
import { resolveLinkSession } from "@chronicle/capture";
import { beginStoryRetry, getStoryForViewer } from "@chronicle/core";
import { beginLogContext, plog } from "@chronicle/pipeline";
import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  beginLogContext();
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const storyId = url.searchParams.get("storyId");
  if (!token || !storyId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(storyId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const rt = await getRuntime();
  const { db } = rt;

  const resolved = await resolveLinkSession(db, token);
  if (!resolved) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const story = await getStoryForViewer(
    db,
    { kind: "link_session", personId: resolved.personId },
    storyId,
  );
  if (!story || story.ownerPersonId !== resolved.personId) {
    // Indistinguishable from "no such story" — never reveals whether the id exists.
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // Only a genuinely-failed draft is retryable. A story that already recovered (rendered), or one
  // that is still processing (no failure marker), is a no-op — don't burn a redundant pipeline run.
  if (story.state !== "draft" || story.processingFailedAt === null) {
    return NextResponse.json({ ok: false, reason: "not_failed" }, { status: 409 });
  }

  // Clear the marker + bump the attempt token in ONE compare-and-swap (gated on the story still
  // being failed), then re-dispatch with that token so the durable queue's payload-dedupe sees a
  // fresh event and actually re-runs the stage. A `null` here means the CAS matched no row — the
  // story was erased, already recovered, or CONCURRENTLY retried by another request — so there is
  // nothing (more) to dispatch. Treat it as a benign 409 (the client re-resolves the page).
  const attempt = await beginStoryRetry(db, storyId);
  if (attempt === null) {
    return NextResponse.json({ ok: false, reason: "already_handled" }, { status: 409 });
  }

  plog("pipeline", "retry: re-dispatching failed story", { story: storyId, attempt });
  await rt.dispatchPipeline(storyId, attempt);

  return NextResponse.json({ ok: true, storyId, attempt });
}
