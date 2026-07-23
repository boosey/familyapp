/**
 * In-hub tell resume page — reopens a self-initiated draft that is waiting in review.
 *
 * Same surface as /hub/tell (no ask) but seeded with the saved draft so StoryComposer lands in the
 * review phase (relisten / edit prose+title / pick tier / share). Reachable from the Stories tab's
 * "continue" affordance (Task 11).
 *
 * The draft read flows through @chronicle/core (getStoryForViewer) — never through the guarded
 * content subpath. A pending_approval story is visible only to its owner, but we still assert
 * ownership + state explicitly (defense in depth) before treating the row as this narrator's draft.
 */
import { redirect } from "next/navigation";
import { getStoryForViewer, listStoryRecordings, listActiveFamiliesForPerson } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { seedComposeFamilies, familyChoiceRequired } from "@/lib/compose-scope";
import { parseFamilyFilter, deriveSingleScope } from "@/lib/family-filter";
import { StoryComposer } from "../../StoryComposer";
import type { DraftInfo } from "../../StoryComposer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TellResumePage({
  params,
  searchParams,
}: {
  params: Promise<{ storyId: string }>;
  searchParams?: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { storyId } = await params;
  const sp = (await searchParams) ?? {};
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  // Anonymous → the real front door (mirrors the /hub gate).
  if (ctx.kind !== "account") {
    redirect("/");
  }

  // Family-first gate: family-less / not-onboarded accounts owe an earlier step.
  const dest = await resolvePostAuthRoute(db, ctx.personId);
  if (dest !== "/hub") redirect(dest);

  // Guard a malformed storyId BEFORE querying: `stories.id` is a uuid column, so a non-UUID value
  // would raise a DB parse error (500). A bad id is just "no such draft" → bounce warmly.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storyId)) {
    redirect("/hub?tab=stories");
  }

  // Load the draft through the authorized read. Three ways this is NOT a resumable draft, all
  // funnelling to the same warm redirect:
  //   1. not found        → getStoryForViewer returns null
  //   2. not owned        → a pending draft is owner-only (null); an approved story of someone
  //                         else's would read but fails the ownerPersonId check below
  //   3. wrong state      → the owner's own story that has already moved past composing/review
  // Resumable states are `draft` (live composing) OR `pending_approval` (review) — ADR-0014 Inc 3
  // slice 9 widened this from pending-only so an appended-but-not-finished draft is reachable.
  const story = await getStoryForViewer(db, ctx, storyId);
  if (
    !story ||
    story.ownerPersonId !== ctx.personId ||
    (story.state !== "draft" && story.state !== "pending_approval")
  ) {
    redirect("/hub?tab=stories");
  }

  // Build the review-phase draft. A text telling has no audio (recordingMediaId null) → empty
  // mediaUrl and no takes; a voice telling resuming is populated exactly as the answer page does.
  let mediaUrl = "";
  let takes: DraftInfo["takes"] = [];
  if (story.recordingMediaId) {
    mediaUrl = `/api/media/${story.recordingMediaId}`;
    const takeRows = await listStoryRecordings(db, story.id);
    takes = takeRows.map((t) => ({
      position: t.position,
      mediaUrl: `/api/media/${t.mediaId}`,
      isInitial: t.position === 0,
    }));
  }

  const draft: DraftInfo = {
    storyId: story.id,
    recordedAt: story.createdAt.toISOString(),
    mediaUrl,
    prose: story.prose ?? "",
    title: story.title ?? "",
    // Narrowed to draft|pending_approval by the guard above; threaded for Slice 10's phase collapse.
    state: story.state,
    takes,
  };

  // Share-step multi-family picker (Task 4), seeded from the shared `?families=` browse filter
  // (ADR-0021, usually ABSENT on a resume → "all"). For a multi-family author "all" means the picker
  // shows unchecked and a pick is REQUIRED before Share — the correct fail-safe. Collapsed to a single
  // scope and validated against the author's OWN active families.
  const tellFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  const tellFamilyIds = tellFamilies.map((f) => f.familyId);
  const scope = deriveSingleScope(parseFamilyFilter(sp.families, tellFamilyIds));
  const seededFamilyIds = [...seedComposeFamilies(scope, tellFamilyIds)];
  const tellChoiceRequired = familyChoiceRequired(scope, tellFamilyIds);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--surface-page)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Content — back + undo/redo live inside ComposingEditor top chrome. */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          maxWidth: 640,
          width: "100%",
          margin: "0 auto",
          padding: "12px clamp(16px, 4vw, 32px) 24px",
          boxSizing: "border-box",
        }}
      >
        {/* key on the draft identity so the client component re-seeds its review-phase state when the
            resumed story changes (mirrors the answer page's remount rationale). */}
        <StoryComposer
          key={draft.storyId}
          mode="tell"
          ask={null}
          draft={draft}
          families={tellFamilies}
          seededFamilyIds={seededFamilyIds}
          familyChoiceRequired={tellChoiceRequired}
        />
      </div>
    </main>
  );
}
