/**
 * Single-story "Read + Listen" page — the finished memoir surface.
 * All content reads go through the single front door (`getStoryForViewer`).
 */
import { notFound } from "next/navigation";
import {
  getStoryForViewer,
  getNarratorProfile,
  listStoryImages,
  listStorySubjects,
  getFavoriteState,
  getLikeState,
} from "@chronicle/core";
import type { Story } from "@chronicle/db";
import { getRuntime } from "@/lib/runtime";
import { markStorySeen, loadStoryFamilyTargets, loadViewerFamilies } from "@/lib/hub-data";
import { hub } from "@/app/_copy";
import { formatStoryDate } from "@/app/hub/tabs/story-browse-helpers";
import { StoryDetailClient } from "./StoryDetailClient";
import { loadTagSuggestionsAction } from "@/app/hub/tag-suggestions-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function eraLabel(eraYear: number | null, eraPlace: string | null): string {
  if (eraYear != null && eraPlace) return `${eraYear} · ${eraPlace}`;
  if (eraYear != null) return String(eraYear);
  return hub.browse.undated;
}

/**
 * The header date line: the ADR-0026 Story date (smart-display via `formatStoryDate`) when the
 * story carries one, else the legacy eraYear/eraLabel display until the read switchover (#247).
 */
function storyDateLabel(
  story: Pick<
    Story,
    "occurredKind" | "occurredDate" | "occurredEndDate" | "eraYear" | "eraLabel"
  >,
): string {
  if (story.occurredKind) {
    return formatStoryDate({
      kind: story.occurredKind,
      date: story.occurredDate ?? "",
      endDate: story.occurredEndDate,
    });
  }
  return eraLabel(story.eraYear ?? null, story.eraLabel ?? null);
}

export default async function StoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[]; families?: string | string[] }>;
}) {
  const { id } = await params;
  const { from, families } = await searchParams;
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  const story = await getStoryForViewer(db, ctx, id);
  if (!story) notFound();

  const isOwner = ctx.kind === "account" && ctx.personId === story.ownerPersonId;

  // "Ask a follow-up" (#77) is offered to a signed-in NON-owner viewer. Since a non-owner only reaches
  // this page when the story is shared+approved (getStoryForViewer's front-door gate), the affordance
  // is implicitly scoped to published stories. `createAsk` re-checks co-membership + source-story SEE,
  // so this flag is a display gate only, not the authorization boundary.
  const canAskFollowUp = ctx.kind === "account" && !isOwner;

  // Mark seen
  if (ctx.kind === "account") {
    await markStorySeen(db, story.id, ctx.personId);
  }

  const narrator = await getNarratorProfile(db, story.ownerPersonId);
  const narratorName = narrator?.spokenName ?? "the family";

  const storyImages = (await listStoryImages(db, story.id)).filter(
    (img): img is typeof img & { familyPhotoId: string } => img.familyPhotoId !== null,
  );

  const viewerFamilies = await loadViewerFamilies(db, ctx);
  const targets =
    (await loadStoryFamilyTargets(db, [story.id], viewerFamilies.map((f) => f.id))).get(story.id) ??
    [];

  const backParams = new URLSearchParams({ tab: "stories" });
  const fromMode = first(from);
  // Preserve the raw `?families=` browse filter (ADR-0021) on the back-link so returning to the hub
  // keeps the viewer's family selection.
  const backFamilies = first(families);
  if (fromMode) backParams.set("mode", fromMode);
  if (backFamilies) backParams.set("families", backFamilies);
  const backHref = `/hub?${backParams.toString()}`;

  // "View in family tree" — the Family hub tab (Tree view), focused on this story's narrator via
  // `?anchor=`, scoped to a family the author is in (first story target family, else the viewer's
  // first family; the tree is single-select, ADR-0021). The tab re-validates `anchor` against the
  // family's visible edges and degrades safely (falls back to the viewer's self-root) on a bad pairing.
  const treeFamilyId = targets[0]?.id ?? viewerFamilies[0]?.id;
  const authorTreeHref = treeFamilyId
    ? `/hub?tab=family&families=${treeFamilyId}&anchor=${story.ownerPersonId}`
    : null;

  // Reactions state
  const favoriteState = await getFavoriteState(db, ctx, story.id);
  const likeState = await getLikeState(db, ctx, story.id);
  const canReact = ctx.kind === "account";

  // Who this story is about (issue #35). SEE-gated read; a signed-in viewer may tag/untag.
  const subjects = (await listStorySubjects(db, ctx, story.id)).map((s) => ({
    personId: s.personId,
    displayName: s.displayName ?? hub.tagInput.unnamedPerson,
  }));

  const suggestions = await loadTagSuggestionsAction(story.id);
  const tagSuggestions = "error" in suggestions ? { people: [], families: [], tags: [] } : suggestions;

  return (
    <main className="kin-page">
      <StoryDetailClient
        storyId={story.id}
        isOwner={isOwner}
        narratorPersonId={story.ownerPersonId}
        canAskFollowUp={canAskFollowUp}
        initialTitle={story.title ?? ""}
        initialTags={story.tags ?? []}
        initialProse={story.prose ?? ""}
        initialTranscript={story.transcript ?? null}
        initialSummary={story.summary ?? null}
        audienceTier={story.audienceTier}
        updatedAt={story.updatedAt ? story.updatedAt.toISOString() : ""}
        narratorName={narratorName}
        eraLabelStr={storyDateLabel(story)}
        storyDate={
          story.occurredKind
            ? {
                kind: story.occurredKind,
                date: story.occurredDate ?? "",
                endDate: story.occurredEndDate ?? null,
              }
            : null
        }
        storyDateProvenance={story.occurredProvenance ?? null}
        recordingMediaId={story.recordingMediaId}
        viewerFamilies={viewerFamilies}
        initialTargetFamilies={targets}
        favoriteState={favoriteState}
        likeState={likeState}
        canReact={canReact}
        backHref={backHref}
        authorTreeHref={authorTreeHref}
        storyImages={storyImages}
        initialPersonSubjects={subjects}
        tagSuggestions={tagSuggestions}
      />
    </main>
  );
}
