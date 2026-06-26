/**
 * Voice-only approval endpoint. Receives the elder's session token, the storyId being approved,
 * the chosen audienceTier, and a wideband audio blob of the spoken approval. Delegates the entire
 * storage-first → atomic-DB-write flow to `captureApproval`, which in turn calls the audited
 * `approveAndShareStory`. Errors return non-OK with no troubleshooting detail (warm-dead-end
 * discipline mirrors `/api/capture`).
 */
import { NextResponse } from "next/server";
import {
  captureApproval,
  InvalidSessionError,
  StoryNotApprovableError,
} from "@chronicle/capture";
import type { AudienceTier } from "@chronicle/db";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";

const VALID_TIERS: ReadonlySet<Exclude<AudienceTier, "private">> = new Set([
  "branch",
  "family",
  "public",
]);

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
  if (!VALID_TIERS.has(tierField as Exclude<AudienceTier, "private">)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const result = await captureApproval(db, storage, {
      sessionToken: token,
      storyId,
      audienceTier: tierField as Exclude<AudienceTier, "private">,
      audio: { bytes, contentType: audio.type || "audio/webm" },
    });
    return NextResponse.json({ ok: true, storyId: result.story.id });
  } catch (err) {
    if (err instanceof InvalidSessionError) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    if (err instanceof StoryNotApprovableError) {
      return NextResponse.json({ ok: false }, { status: 409 });
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
