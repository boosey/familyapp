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
import { getRuntime } from "@/lib/runtime";
import { markStorySeen, loadStoryFamilyTargets, loadViewerFamilies } from "@/lib/hub-data";
import { hub } from "@/app/_copy";
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

export default async function StoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[]; scope?: string | string[] }>;
}) {
  const { id } = await params;
  const { from, scope } = await searchParams;
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  const story = await getStoryForViewer(db, ctx, id);
  if (!story) notFound();

  const isOwner = ctx.kind === "account" && ctx.personId === story.ownerPersonId;

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
  const backScope = first(scope);
  if (fromMode) backParams.set("mode", fromMode);
  if (backScope) backParams.set("scope", backScope);
  const backHref = `/hub?${backParams.toString()}`;

  // "View in family tree" — root the tree on this story's narrator, scoped to a family the author
  // is in (first story target family, else the back-scope, else the viewer's first family). The tree
  // page validates `root` against the family's visible edges and degrades safely on a bad pairing.
  const treeScope = targets[0]?.id ?? backScope ?? viewerFamilies[0]?.id;
  const authorTreeHref = treeScope
    ? `/hub/tree?scope=${treeScope}&root=${story.ownerPersonId}`
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
        initialTitle={story.title ?? ""}
        initialTags={story.tags ?? []}
        initialProse={story.prose ?? ""}
        initialTranscript={story.transcript ?? null}
        initialSummary={story.summary ?? null}
        audienceTier={story.audienceTier}
        updatedAt={story.updatedAt ? story.updatedAt.toISOString() : ""}
        narratorName={narratorName}
        eraLabelStr={eraLabel(story.eraYear ?? null, story.eraLabel ?? null)}
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
