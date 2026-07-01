/**
 * Viewer-scoped processing-status read for the login-free narrator surface (issue #2, slice 2b).
 *
 * After POST /api/capture returns a `storyId`, the recorder polls this endpoint until the story is
 * `ready` (rendered → `pending_approval`), then routes to the approval surface. With the durable
 * Inngest queue the story can still be `draft` when capture returns; this is how the client learns
 * when the out-of-band pipeline has finished.
 *
 * Auth model — identical to /api/capture: the session token IS the identity. There is deliberately
 * no account-cookie auth here. The token resolves (inside the domain) to the narrator's Person id;
 * the story is then read through the SINGLE FRONT DOOR (`getStoryForViewer` with a `link_session`
 * AuthContext), so a wrong/expired token (401) or a story the narrator does not own (404) leaks
 * nothing. We additionally pin `ownerPersonId === resolved.personId` so a valid token can only poll
 * its own narrator's stories — the same ownership posture the approve page enforces.
 */
import { resolveLinkSession } from "@chronicle/capture";
import { getStoryForViewer } from "@chronicle/core";
import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/runtime";
import { mapStoryStateToStatus } from "@/lib/answer-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const storyId = url.searchParams.get("storyId");
  if (!token || !storyId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { db } = await getRuntime();

  const resolved = await resolveLinkSession(db, token);
  if (!resolved) {
    // Unknown / revoked / expired token — same 401 as the capture endpoint.
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

  return NextResponse.json({
    ok: true,
    status: mapStoryStateToStatus(story.state),
    storyId: story.id,
  });
}
