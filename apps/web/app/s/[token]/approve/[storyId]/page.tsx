/**
 * Voice-only approval surface. The elder lands here after the pipeline has prepared a draft. The
 * page renders in Kindred's intimate `hearth` theme; the proposed prose appears as a serif read,
 * the original wide-band recording is one tap away, and the actual approval is spoken via
 * `ApprovalRecorder`.
 *
 * Server-side: resolves the session token, confirms the story exists for this elder via the
 * single front door, and refuses anything that isn't `pending_approval`.
 */
import { resolveElderSession } from "@chronicle/capture";
import { getStoryForViewer, getElderProfile } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { ApprovalRecorder } from "./ApprovalRecorder";
import { KindredListenBar, KindredPromptCard } from "@/app/_kindred";

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
      <main className="kin-fullbleed" data-theme="hearth" style={{ alignItems: "center", justifyContent: "center", padding: 32 }}>
        <h1 style={{ fontSize: "var(--kin-text-title)", margin: 0 }}>Welcome.</h1>
        <p className="kin-muted" style={{ maxWidth: "32ch", textAlign: "center", marginTop: 16 }}>
          This link is resting for now. Whoever invited you will help you get started again.
        </p>
      </main>
    );
  }

  const story = await getStoryForViewer(
    db,
    { kind: "elder_session", personId: resolved.personId },
    storyId,
  );

  if (!story || story.ownerPersonId !== resolved.personId || story.state !== "pending_approval") {
    return (
      <main className="kin-fullbleed" data-theme="hearth" style={{ alignItems: "center", justifyContent: "center", padding: 32 }}>
        <h1 style={{ fontSize: "var(--kin-text-title)", margin: 0 }}>Thank you.</h1>
        <p className="kin-muted" style={{ maxWidth: "32ch", textAlign: "center", marginTop: 16 }}>
          This one is already settled. You can close this window whenever you're ready.
        </p>
      </main>
    );
  }

  const profile = await getElderProfile(db, resolved.personId);
  const spokenName = profile?.spokenName ?? "there";
  const proposed = story.prose ?? story.summary ?? "";

  return (
    <main className="kin-fullbleed" data-theme="hearth">
      <section
        style={{
          flex: 1,
          padding: "clamp(28px, 5vw, 56px) clamp(20px, 5vw, 56px)",
          display: "flex",
          flexDirection: "column",
          gap: 28,
          maxWidth: 760,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <div>
          <div className="kin-eyebrow">For approval</div>
          <h1 style={{ fontSize: "var(--kin-text-title)", margin: "10px 0 0", lineHeight: 1.1 }}>
            Hello, {spokenName}.
          </h1>
        </div>

        {story.title ? (
          <KindredPromptCard
            eyebrow="The story so far"
            question={`"${story.title}"`}
          />
        ) : null}

        <div>
          <div className="kin-label" style={{ marginBottom: 10 }}>Your own voice</div>
          <KindredListenBar src={`/api/media/${story.recordingMediaId}`} />
        </div>

        {proposed ? (
          <div>
            <div className="kin-label" style={{ marginBottom: 10 }}>How it reads on the page</div>
            <p
              style={{
                fontFamily: "var(--kin-font-serif)",
                fontSize: "var(--kin-text-story)",
                lineHeight: "var(--kin-leading-story)",
                color: "var(--kin-body)",
                background: "var(--kin-surface)",
                border: "1px solid var(--kin-line)",
                borderRadius: "var(--kin-radius-md)",
                padding: "22px 24px",
                margin: 0,
                whiteSpace: "pre-wrap",
              }}
            >
              {proposed}
            </p>
          </div>
        ) : null}

        <p className="kin-ink-2" style={{ fontSize: "var(--kin-text-h3)", margin: 0, lineHeight: 1.5, textAlign: "center" }}>
          When you're ready, tell me whether you'd like your family to hear this — and who you want
          to share it with.
        </p>

        <ApprovalRecorder token={token} storyId={story.id} />
      </section>
    </main>
  );
}
