import { Suspense } from "react";
import { StoryBrowse } from "./StoryBrowse";
import type { StoryItem, ViewerFamily } from "./story-browse-types";
import type { MemberWithStories } from "@/lib/hub-data";
import { hub } from "@/app/_copy";

interface StoriesTabProps {
  feed: MemberWithStories[];
  /** The signed-in viewer — their own stories are never flagged "New". */
  viewerPersonId: string;
  /** Story ids this viewer has already opened. */
  seenStoryIds: Set<string>;
  /** For each story id, the families it targets, ALREADY intersected with the viewer's families. */
  familyTargets: Map<string, ViewerFamily[]>;
  /** The viewer's active families — the options for the family-scope filter. */
  viewerFamilies: ViewerFamily[];
  /** The viewer's display name — labels the Timeline "Just {viewer}" toggle. */
  viewerName: string;
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
  viewerFamilies,
  viewerName,
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
        personName: slot.person.spokenName,
        eraYear,
        eraLabel: story.eraLabel ?? null,
        eventLabel: eventLabelOf(eraYear, story.eraLabel ?? null),
        families: familyTargets.get(story.id) ?? [],
        // New to this viewer until opened — but a narrator's own stories are never "new" to them.
        isNew: slot.person.id !== viewerPersonId && !seenStoryIds.has(story.id),
        href: `/hub/stories/${story.id}`,
      };
      return { item, sort: sortDate.getTime() };
    }),
  );
  dated.sort((a, b) => b.sort - a.sort);
  const items: StoryItem[] = dated.map((d) => d.item);

  if (items.length === 0) {
    return (
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-muted)",
          margin: 0,
        }}
      >
        {hub.stories.empty}
      </p>
    );
  }

  return (
    <Suspense>
      <StoryBrowse
        items={items}
        viewerFamilies={viewerFamilies}
        viewerPersonId={viewerPersonId}
        viewerName={viewerName}
      />
    </Suspense>
  );
}
