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
import {
  getStoryForViewer,
  listOutstandingDrafts,
  listStoryRecordings,
  listAskSubjectPhotos,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { getAskForNarrator } from "@/lib/answer-data";
import { hub } from "@/app/_copy";
import { StoryComposer } from "../../StoryComposer";
import type { DraftInfo } from "../../StoryComposer";

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

  // ADR-0009 Phase 3: the photo(s) this ask is ABOUT, shown to the narrator as context while they
  // answer. The bytes are served by the audited `/api/album-photo/[id]` route, which re-checks read
  // authorization per request — a photo the narrator can't see simply 404s (no ungated endpoint).
  const subjectPhotoIds = await listAskSubjectPhotos(db, askId);

  // Check for an outstanding draft for this ask. `listOutstandingDrafts` returns most-recent-first
  // and includes BOTH the live `draft` state and `pending_approval` (ADR-0014 Inc 3 slice 9 — a
  // routing relax from the pending-only `listOutstandingAnswerDrafts`), so `.find` yields the latest
  // resumable draft for this ask regardless of state. (The Questions tab keeps its pending-only split
  // via `questionsTabAnswerDrafts`; this page is a distinct consumer that resumes a live draft too.)
  const drafts = await listOutstandingDrafts(db, ctx.personId);
  const draftEntry = drafts.find((d) => d.askId === askId) ?? null;

  // If a draft exists, get the story (owner always sees their own draft) for the recording URL.
  let draft: DraftInfo | null = null;
  if (draftEntry) {
    const story = await getStoryForViewer(db, ctx, draftEntry.storyId);
    if (story) {
      // Ordered takes for the multi-take review (relisten per take + drop a follow-up take). Each
      // maps to the authorized /api/media route. A thread-of-one still yields exactly one take.
      const takeRows = await listStoryRecordings(db, story.id);
      const takes = takeRows.map((t) => ({
        position: t.position,
        mediaUrl: `/api/media/${t.mediaId}`,
        isInitial: t.position === 0,
      }));
      draft = {
        storyId: story.id,
        recordedAt: draftEntry.recordedAt.toISOString(),
        // A voice draft has a recording pointer; a text answer draft leaves it null → the client
        // omits the audio block when mediaUrl is empty (mirrors the tell resume page).
        mediaUrl: story.recordingMediaId ? `/api/media/${story.recordingMediaId}` : "",
        prose: story.prose ?? "",
        title: story.title ?? "",
        // Threaded for Slice 10's phase collapse. draftEntry.state matches (same story row), but the
        // freshly-read `story.state` is authoritative here.
        state: story.state === "draft" ? "draft" : "pending_approval",
        takes,
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
        {/* ADR-0009 Phase 3 — the ask's subject photo(s), shown as answer-time context. Rendered
            above the composer so the narrator sees what the question is about before they speak. */}
        {subjectPhotoIds.length > 0 ? (
          <section
            aria-label={hub.answer.aboutThisPhoto}
            style={{ marginBottom: 24 }}
          >
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-label)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--support)",
                margin: "0 0 10px",
                textAlign: "center",
              }}
            >
              {hub.answer.aboutThisPhoto}
            </p>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gridTemplateColumns:
                  subjectPhotoIds.length === 1
                    ? "1fr"
                    : "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 12,
                justifyItems: "center",
              }}
            >
              {subjectPhotoIds.map((photoId) => (
                <li key={photoId} style={{ margin: 0, width: "100%" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- audited byte route. */}
                  <img
                    src={`/api/album-photo/${photoId}`}
                    alt={hub.album.photoAlt(null)}
                    style={{
                      width: "100%",
                      maxHeight: "40dvh",
                      objectFit: "contain",
                      borderRadius: "var(--radius-md)",
                      display: "block",
                      background: "var(--surface-sunken)",
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/*
         * `key` flips on the record→review transition (and back on re-record). router.refresh()
         * updates the server props but does NOT remount a client component, so without this key
         * StoryComposer's state (proseDraft/titleDraft seeded from draft, op, tier, …) stays stuck at its
         * record-phase mount values — the review editor would render empty even though draft.prose
         * is populated. Keying on the draft identity forces a fresh mount that re-seeds all state.
         */}
        <StoryComposer
          key={draft?.storyId ?? "record"}
          mode="answer"
          ask={{
            id: askId,
            questionText: askDetail.questionText,
            askerName: askDetail.askerSpokenName,
          }}
          draft={draft}
        />
      </div>
    </main>
  );
}
