import { Suspense } from "react";
import { StoryBrowse } from "./StoryBrowse";
import { StoriesControls, type SelfDraft } from "./StoriesControls";
import { resolveCoverPhotoId, resolveGalleryPhotoIds } from "./story-browse-helpers";
import type { StoryItem, ViewerFamily } from "./story-browse-types";
import type { MemberWithStories } from "@/lib/hub-data";
import { hub } from "@/app/_copy";
import { selectedIdList, type FamilyFilter } from "@/lib/family-filter";
import styles from "./StoriesTab.module.css";

interface StoriesTabProps {
  feed: MemberWithStories[];
  /** The signed-in viewer — their own stories are never flagged "New". */
  viewerPersonId: string;
  /** Story ids this viewer has already opened. */
  seenStoryIds: Set<string>;
  /** For each story id, the families it targets, ALREADY intersected with the viewer's families. */
  familyTargets: Map<string, ViewerFamily[]>;
  /** For each story id with a cover accompaniment image (ADR-0009), its `family_photo_id`. */
  storyCovers: Map<string, string>;
  /** For each story id, ALL its renderable accompaniment photo ids in render order (cover first).
   *  Drives the card's non-cover thumbnail row. A text-only story has no entry. */
  storyPhotos: Map<string, string[]>;
  /** The viewer's active families — the options for the family-scope filter. */
  viewerFamilies: ViewerFamily[];
  /** The viewer's display name — labels the Timeline "Just {viewer}" toggle. */
  viewerName: string;
  /** The viewer's own ask-less drafts still awaiting approval — the "Finish what you started" list. */
  selfDrafts: SelfDraft[];
  /**
   * The shared `?families=` browse filter (ADR-0021, #47), parsed against the viewer's active
   * families: `all` = the whole deduped pool, `none` = an explicit empty selection (honest empty
   * state, NOT the full pool), `some` = only stories targeting one of the selected families.
   */
  filter: FamilyFilter;
  /**
   * The viewer's ACTIVE families (id + name), in the SAME set/order the `filter` was parsed against
   * (`listActiveFamiliesForPerson`). Drives the multi-select chip bar and resolves the selected-id
   * set. Must match the parse basis so the chips and the narrowing agree.
   */
  activeFamilies: ViewerFamily[];
  /** #138: whether the narrator's biographical intake is incomplete — drives the compact intake
   *  reminder button on the control row (replaces the former full-width banner). Defaults to false
   *  (no reminder) when omitted. */
  intakeIncomplete?: boolean;
}

/** The era a story is ABOUT, when known: "1962 · MARCH" with a place note, else "1962". Null when
 *  the story has no era year (it becomes an Undated Timeline entry). */
function eventLabelOf(eraYear: number | null, eraLabel: string | null): string | null {
  if (eraYear === null) return null;
  return eraLabel ? `${eraYear} · ${eraLabel.toUpperCase()}` : `${eraYear}`;
}

/**
 * Stories tab — the server producer for the Story Browse surface. Flattens the per-member authorized
 * feed into one serializable pool of StoryItems (pre-sorted reverse-chronological by shared/recorded
 * time), then hands it to the client StoryBrowse component (Feed / Timeline / Search + family scope).
 * All authorization already happened upstream in `loadHubFeed` → `listStoriesForViewer`.
 */
export function StoriesTab({
  feed,
  viewerPersonId,
  seenStoryIds,
  familyTargets,
  storyCovers,
  storyPhotos,
  viewerFamilies,
  viewerName,
  selfDrafts,
  filter,
  activeFamilies,
  intakeIncomplete = false,
}: StoriesTabProps) {
  const dated = feed.flatMap((slot) =>
    slot.stories.map((story) => {
      // Recency for the reverse-chronological feed order: most-recently approved (or created) first.
      const sortDate = story.approvedAt ?? story.createdAt;
      const eraYear = story.eraYear ?? null;
      const item: StoryItem = {
        id: story.id,
        title: story.title ?? hub.stories.untitled,
        summary: story.summary ?? null,
        prose: story.prose ?? null,
        tags: story.tags ?? [],
        personId: slot.person.id,
        personName: slot.person.spokenName ?? "",
        eraYear,
        eraLabel: story.eraLabel ?? null,
        eventLabel: eventLabelOf(eraYear, story.eraLabel ?? null),
        families: familyTargets.get(story.id) ?? [],
        coverPhotoId: resolveCoverPhotoId(storyCovers, story.id),
        photoIds: resolveGalleryPhotoIds(storyPhotos, story.id),
        // New to this viewer until opened — but a narrator's own stories are never "new" to them.
        isNew: slot.person.id !== viewerPersonId && !seenStoryIds.has(story.id),
        href: `/hub/stories/${story.id}`,
      };
      return { item, sort: sortDate.getTime() };
    }),
  );
  dated.sort((a, b) => b.sort - a.sort);
  // Dedup by story id: the per-member feed union can list a story shared to two of the viewer's
  // families more than once. Keep the first (most-recent, post-sort) occurrence so a story appears
  // exactly once in the pool — in "all" and in EACH of its families' scoped views (StoryBrowse filters
  // this deduped pool by the hub scope).
  const seen = new Set<string>();
  const items: StoryItem[] = [];
  for (const d of dated) {
    if (seen.has(d.item.id)) continue;
    seen.add(d.item.id);
    items.push(d.item);
  }

  // Multi-select family filter (ADR-0021, #47), mirroring AlbumSurface. Resolve the selected-id set
  // from the shared filter against the SAME active-family set the filter was parsed against, so the
  // chip bar and the narrowing agree. `all` → every active id; `none` → []; `some` → the chosen ids.
  const activeIds = activeFamilies.map((f) => f.id);
  const selectedIds = selectedIdList(filter, activeIds);

  return (
    <div className={styles.wrap}>
      {/* The single control row (#125): family-filter chips (≥2 families), a compact draft-reminder,
          and the right-justified "Tell a story" button. Sits above every branch so it shows even in
          the empty state. The chip `selected` value matches the parse basis (all → "all"; else ids). */}
      <StoriesControls
        activeFamilies={activeFamilies}
        selected={filter.kind === "all" ? "all" : selectedIds}
        selfDrafts={selfDrafts}
        intakeIncomplete={intakeIncomplete}
      />

      {filter.kind === "none" ? (
        // Explicit empty selection (ADR-0021): every chip toggled OFF is an honest empty state — no
        // browse pool — rather than a silent "show all". The chip bar stays (above) so the viewer can
        // turn a family back on. Mirrors AlbumSurface's `none` short-circuit.
        <p className={styles.emptyText}>{hub.stories.noFamiliesSelected}</p>
      ) : items.length === 0 ? (
        // No stories yet — the control row's "Tell a story" button is the entry point; here we keep
        // only the welcoming empty note.
        <p className={styles.emptyTextMuted}>
          {/* A pending-only viewer (member of no family yet) reaches the hub with an empty feed since
              Gate C was retired — give them a coherent, welcoming empty state (Task 4.6) rather than
              the generic "when someone shares…" copy that assumes they already have a family. */}
          {viewerFamilies.length === 0 ? hub.shell.pendingEmpty : hub.stories.empty}
        </p>
      ) : (
        <Suspense>
          <StoryBrowse
            items={items}
            viewerFamilies={viewerFamilies}
            viewerPersonId={viewerPersonId}
            viewerName={viewerName}
            selectedIds={selectedIds}
            allSelected={filter.kind === "all"}
          />
        </Suspense>
      )}
    </div>
  );
}
