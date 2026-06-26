/**
 * Voice-only approval surface. The elder lands here after the pipeline has prepared a draft for
 * approval. Warm copy discipline mirrors `/s/[token]`: one greeting, one big record control, one
 * tier picker (default: family), no troubleshooting on failure.
 *
 * Server-side: resolves the session token, confirms the story exists for this elder via the
 * single front door, and refuses anything that isn't `pending_approval`.
 */
import { resolveElderSession } from "@chronicle/capture";
import { getStoryForViewer, getElderProfile } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { ApprovalRecorder } from "./ApprovalRecorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ApprovePage({
  params,
}: {
  params: Promise<{ token: string; storyId: string }>;
}) {
  const { token, storyId } = await params;
  const { db } = await getRuntime();

  const resolved = await resolveElderSession(db, token);
  if (!resolved) {
    return (
      <main className="screen">
        <h1 className="greeting">Welcome.</h1>
        <p className="subtle">
          This link is resting for now. Whoever invited you will help you get
          started again.
        </p>
      </main>
    );
  }

  const story = await getStoryForViewer(
    db,
    { kind: "elder_session", personId: resolved.personId },
    storyId,
  );

  if (
    !story ||
    story.ownerPersonId !== resolved.personId ||
    story.state !== "pending_approval"
  ) {
    return (
      <main className="screen">
        <h1 className="greeting">Thank you.</h1>
        <p className="subtle">
          This one is already settled. You can close this window whenever
          you’re ready.
        </p>
      </main>
    );
  }

  const profile = await getElderProfile(db, resolved.personId);
  const spokenName = profile?.spokenName ?? "there";

  return (
    <main className="screen">
      <h1 className="greeting">Hello, {spokenName}.</h1>
      {story.title ? (
        <p className="subtle" style={{ maxWidth: "32ch" }}>
          “{story.title}”
        </p>
      ) : null}
      <p className="subtle">
        When you’re ready, tell me whether you’d like your family to hear this
        — and who you want to share it with.
      </p>
      <ApprovalRecorder token={token} storyId={story.id} />
    </main>
  );
}
