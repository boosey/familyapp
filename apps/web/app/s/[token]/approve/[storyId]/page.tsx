/**
 * Voice-only approval surface. The narrator lands here after the pipeline has prepared a draft. The
 * original wide-band recording is one tap away in a listen bar (pinned to the bottom for thumb reach),
 * and the actual approval is spoken via `ApprovalRecorder`.
 *
 * Server-side: resolves the session token, confirms the story exists for this narrator via the
 * single front door, and refuses anything that isn't `pending_approval`.
 */
import { resolveLinkSession } from "@chronicle/capture";
import { getStoryForViewer } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { ApprovalRecorder } from "./ApprovalRecorder";
import { ApprovePending } from "./ApprovePending";
import { KindredListenBar } from "@/app/_kindred";
import { BrandMark } from "@/app/_brand/BrandMark";
import { capture } from "@/app/_copy";
import styles from "./approve.module.css";

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
      <main className={`kin-fullbleed ${styles.restingMain}`}>
        <h1 className={styles.restingTitle}>{capture.approve.welcome}</h1>
        <p className={styles.restingBody}>{capture.approve.resting}</p>
      </main>
    );
  }

  const story = await getStoryForViewer(
    db,
    { kind: "link_session", personId: resolved.personId },
    storyId,
  );

  // Draft-tolerant (slice 2b): the narrator may arrive while the durable pipeline is still
  // rendering (story === draft). Show the "almost ready" polling view, which reveals this same
  // approve UI the moment the story reaches pending_approval. The owner always sees their own
  // draft (front door), so this stays scoped to the narrator's own story.
  if (story && story.ownerPersonId === resolved.personId && story.state === "draft") {
    return <ApprovePending token={token} storyId={story.id} />;
  }

  if (!story || story.ownerPersonId !== resolved.personId || story.state !== "pending_approval") {
    return (
      <main className={`kin-fullbleed ${styles.restingMain}`}>
        <h1 className={styles.restingTitle}>{capture.approve.thanks}</h1>
        <p className={styles.restingBody}>{capture.approve.alreadySettled}</p>
      </main>
    );
  }

  return (
    <main className={`kin-fullbleed ${styles.main}`}>
      <section className={styles.section}>
        <div className={styles.headerRow}>
          <span className={styles.brand}>
            <BrandMark size={24} />
            {capture.approve.brand}
          </span>
          <span className={styles.badge}>{capture.approve.yourStory}</span>
        </div>

        <div className={styles.storyShelf}>
          <h1 className={styles.headline}>{capture.approve.readyToShare}</h1>
          <p className={styles.subtext}>{capture.approve.haveAListen}</p>
        </div>

        <div className={styles.recorder}>
          <ApprovalRecorder token={token} storyId={story.id} prose={story.prose ?? ""} />
        </div>

        <div className={styles.listenBottom}>
          <KindredListenBar src={`/api/media/${story.recordingMediaId}`} />
        </div>
      </section>
    </main>
  );
}
