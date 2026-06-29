/**
 * In-hub answer page — full-screen record → review flow for a signed-in narrator.
 *
 * Auth: account only. Link-session narrators are directed to /s/[token] by the magic-link route.
 * Data: loads the Ask, checks for an existing draft, and gets the draft recording URL (via the
 * authorized /api/media route) if a draft exists.
 *
 * Content reads flow through @chronicle/core (getStoryForViewer) — never through the guarded
 * content subpath directly. The `asks` and `persons` tables are open schema tables (fine to read).
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getStoryForViewer, listOutstandingAnswerDrafts } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { getAskForNarrator } from "@/lib/answer-data";
import { hub } from "@/app/_copy";
import { AnswerFlow } from "./AnswerFlow";
import type { DraftInfo } from "./AnswerFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AnswerPage({
  params,
}: {
  params: Promise<{ askId: string }>;
}) {
  const { askId } = await params;
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (ctx.kind !== "account") {
    redirect("/hub");
  }

  // Guard a malformed askId BEFORE querying: `asks.id` is a uuid column, so a non-UUID value
  // would raise a DB parse error (500). A bad id is just "no such question" → bounce warmly.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(askId)) {
    redirect("/hub?tab=questions");
  }

  // Load the ask — returns null if not found OR not targeted at this narrator.
  const askDetail = await getAskForNarrator(db, askId, ctx.personId);
  if (!askDetail) {
    redirect("/hub?tab=questions");
  }

  // An already-answered ask has no live answer flow (recording into it would create a dead draft
  // that Share can never close — SF-4). queued/routed remain answerable.
  if (askDetail.status === "answered") {
    redirect("/hub?tab=questions");
  }

  // Check for an outstanding draft for this ask.
  const drafts = await listOutstandingAnswerDrafts(db, ctx.personId);
  const draftEntry = drafts.find((d) => d.askId === askId) ?? null;

  // If a draft exists, get the story (owner always sees their own draft) for the recording URL.
  let draft: DraftInfo | null = null;
  if (draftEntry) {
    const story = await getStoryForViewer(db, ctx, draftEntry.storyId);
    if (story) {
      draft = {
        storyId: story.id,
        recordedAt: draftEntry.recordedAt.toISOString(),
        mediaUrl: `/api/media/${story.recordingMediaId}`,
        prose: story.prose ?? "",
      };
    }
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--surface-page)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Back nav */}
      <div
        style={{
          padding: "20px clamp(16px, 4vw, 32px) 0",
          maxWidth: 640,
          width: "100%",
          margin: "0 auto",
          alignSelf: "flex-start",
          boxSizing: "border-box",
        }}
      >
        <Link
          href="/hub?tab=questions"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {hub.answer.backToQuestions}
        </Link>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          maxWidth: 640,
          width: "100%",
          margin: "0 auto",
          padding: "32px clamp(16px, 4vw, 32px) 48px",
          boxSizing: "border-box",
        }}
      >
        <AnswerFlow
          askId={askId}
          questionText={askDetail.questionText}
          askerName={askDetail.askerSpokenName}
          draft={draft}
        />
      </div>
    </main>
  );
}
