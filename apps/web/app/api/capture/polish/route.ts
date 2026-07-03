/**
 * OPT-IN "Polish with AI" for the voice-approval prose editor (the /s/[token] capture surface).
 * Mirrors the hub's `polishAnswerProseAction`, but the identity model is the capture surface's: the
 * session token IS the identity (validated via `resolveLinkSession`), and we additionally confirm the
 * story is THIS narrator's own and still `pending_approval` — so the endpoint can't be used to run the
 * LLM against an arbitrary story or by a stranger with a bare token.
 *
 * Stateless: persists nothing. Returns the tidied prose for the editor to show; the narrator can undo
 * it, and only the subsequent spoken approval (`/api/capture/approve`) writes the L3 correction.
 */
import { NextResponse } from "next/server";
import { resolveLinkSession } from "@chronicle/capture";
import { getStoryForViewer } from "@chronicle/core";
import { polishProse } from "@chronicle/pipeline";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const { db, languageModel } = await getRuntime();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const token = form.get("token");
  const storyId = form.get("storyId");
  const prose = form.get("prose");
  if (typeof token !== "string" || typeof storyId !== "string" || typeof prose !== "string") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const resolved = await resolveLinkSession(db, token);
  if (!resolved) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // The story must be this narrator's own and still awaiting approval (the only state where the
  // approve editor is live). Front door: a non-owner gets null, so this can't probe foreign stories.
  const story = await getStoryForViewer(
    db,
    { kind: "link_session", personId: resolved.personId },
    storyId,
  );
  if (!story || story.ownerPersonId !== resolved.personId || story.state !== "pending_approval") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const result = await polishProse(languageModel, { prose });
    return NextResponse.json({ ok: true, prose: result.prose });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
