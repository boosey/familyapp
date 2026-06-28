/**
 * Voice-only approval surface. The narrator lands here after the pipeline has prepared a draft. The
 * page renders in Kindred's intimate `hearth` theme; the original wide-band recording is one tap
 * away in a listen bar, and the actual approval is spoken via `ApprovalRecorder`.
 *
 * Server-side: resolves the session token, confirms the story exists for this narrator via the
 * single front door, and refuses anything that isn't `pending_approval`.
 */
import { resolveLinkSession } from "@chronicle/capture";
import { getStoryForViewer, getNarratorProfile } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { ApprovalRecorder } from "./ApprovalRecorder";
import { KindredListenBar } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ApprovePage({
  params,
}: {
  params: Promise<{ token: string; storyId: string }>;
}) {
  const { token, storyId } = await params;
  const { db } = await getRuntime();

  const resolved = await resolveLinkSession(db, token);
  if (!resolved) {
    return (
      <main
        className="kin-fullbleed"        style={{ alignItems: "center", justifyContent: "center", padding: 32 }}
      >
        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontWeight: 400,
            fontSize: "var(--text-display)",
            margin: 0,
            color: "var(--text-body)",
          }}
        >
          Welcome.
        </h1>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            maxWidth: "32ch",
            textAlign: "center",
            marginTop: 16,
          }}
        >
          This link is resting for now. Whoever invited you will help you get started again.
        </p>
      </main>
    );
  }

  const story = await getStoryForViewer(
    db,
    { kind: "link_session", personId: resolved.personId },
    storyId,
  );

  if (!story || story.ownerPersonId !== resolved.personId || story.state !== "pending_approval") {
    return (
      <main
        className="kin-fullbleed"        style={{ alignItems: "center", justifyContent: "center", padding: 32 }}
      >
        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontWeight: 400,
            fontSize: "var(--text-display)",
            margin: 0,
            color: "var(--text-body)",
          }}
        >
          Thank you.
        </h1>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            maxWidth: "32ch",
            textAlign: "center",
            marginTop: 16,
          }}
        >
          This one is already settled. You can close this window whenever you&apos;re ready.
        </p>
      </main>
    );
  }

  const profile = await getNarratorProfile(db, resolved.personId);

  return (
    <main className="kin-fullbleed">
      <section
        style={{
          flex: 1,
          padding: "clamp(28px, 5vw, 52px) clamp(20px, 5vw, 48px)",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          maxWidth: 760,
          width: "100%",
          alignSelf: "center",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 30,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-ui-lg)",
              color: "var(--text-meta)",
            }}
          >
            Family Chronicle
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--support)",
            }}
          >
            Your Story
          </span>
        </div>

        {/* Headline */}
        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontWeight: 400,
            fontSize: "clamp(2rem, 6vw, 46px)",
            lineHeight: 1.1,
            color: "var(--text-body)",
            margin: 0,
          }}
        >
          Ready to share this one?
        </h1>

        {/* Subtext */}
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            lineHeight: 1.5,
            color: "var(--text-muted)",
            margin: "14px 0 0",
            maxWidth: "28ch",
          }}
        >
          Have a listen first. Then tell me who should be able to hear it.
        </p>

        {/* Listen bar */}
        <div style={{ marginTop: 24 }}>
          <KindredListenBar src={`/api/media/${story.recordingMediaId}`} />
        </div>

        {/* Approval recorder: tier picker + voice button */}
        <div
          style={{
            marginTop: 30,
            flex: 1,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ApprovalRecorder token={token} storyId={story.id} />
        </div>
      </section>
    </main>
  );
}
