/**
 * Voice-only approval endpoint. Receives the narrator's session token, the storyId being approved,
 * the chosen audienceTier, and a wideband audio blob of the spoken approval. Delegates the entire
 * storage-first → atomic-DB-write flow to `captureApproval`, which in turn calls the audited
 * `approveAndShareStory`. Errors return non-OK with no troubleshooting detail (warm-dead-end
 * discipline mirrors `/api/capture`).
 *
 * Auth model (intentional, same as `/api/capture`): no `getCurrentAuthContext()` — the session
 * token IS the identity and is validated inside `captureApproval` (`InvalidSessionError` → 401).
 * The audience-tier rule is the domain's, not the route's: `captureApproval` throws
 * `InvalidAudienceTierError` (→ 400) for any non-shareable tier, so the route does not re-encode a
 * tier whitelist. The route validates only request SHAPE (fields present, audio non-empty).
 */
import { NextResponse } from "next/server";
import {
  captureApproval,
  InvalidAudienceTierError,
  InvalidSessionError,
  StoryNotApprovableError,
} from "@chronicle/capture";
import type { AudienceTier } from "@chronicle/db";
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
  const storyId = form.get("storyId");
  const tierField = form.get("audienceTier");
  const audio = form.get("audio");

  if (
    typeof token !== "string" ||
    typeof storyId !== "string" ||
    typeof tierField !== "string" ||
    !(audio instanceof Blob)
  ) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const correctedProse = form.get("correctedProse");

  try {
    // The tier is validated inside `captureApproval` (the domain owns the shareable-tier rule);
    // the cast just satisfies the input type at this untrusted boundary.
    const result = await captureApproval(db, storage, {
      actor: { kind: "link_session", token },
      storyId,
      audienceTier: tierField as Exclude<AudienceTier, "private">,
      audio: { bytes, contentType: audio.type || "audio/webm" },
      ...(typeof correctedProse === "string" && correctedProse.length > 0
        ? { correctedProse }
        : {}),
    });
    return NextResponse.json({ ok: true, storyId: result.story.id });
  } catch (err) {
    if (err instanceof InvalidAudienceTierError) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (err instanceof InvalidSessionError) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    if (err instanceof StoryNotApprovableError) {
      return NextResponse.json({ ok: false }, { status: 409 });
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
