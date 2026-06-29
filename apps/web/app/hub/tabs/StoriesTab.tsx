import { StoriesBrowser, type StoryItem, type StoryFacets } from "./StoriesBrowser";
import type { MemberWithStories } from "@/lib/hub-data";
import { hub } from "@/app/_copy";

interface StoriesTabProps {
  feed: MemberWithStories[];
  /** The signed-in viewer — their own stories are never flagged "New". */
  viewerPersonId: string;
  /** Story ids this viewer has already opened. */
  seenStoryIds: Set<string>;
}

function decadeOf(d: Date): string {
  return `${Math.floor(d.getFullYear() / 10) * 10}s`;
}

/** Short recorded-date stamp for the card's right corner, e.g. "JUN 2026". */
function recordedLabelOf(d: Date): string {
  const year = d.getFullYear();
  const month = d.toLocaleString(undefined, { month: "short" }).toUpperCase();
  return `${month} ${year}`;
}

/** The era a story is ABOUT, when known. Null when the story has no historical era. */
function eraLabelOf(eraYear: number, eraLabel: string | null): string {
  return eraLabel ? `${eraYear} · ${eraLabel.toUpperCase()}` : `${eraYear}`;
}

function eraDecade(eraYear: number): string {
  return `${Math.floor(eraYear / 10) * 10}s`;
}

/**
 * Stories tab — flattens the per-member authorized feed into a single browsable pool, derives the
 * finder facets (Person / Era / Topic) from real data, and hands them to the client-side
 * StoriesBrowser (the "Find Stories" finder + featured card + grid).
 */
export function StoriesTab({ feed, viewerPersonId, seenStoryIds }: StoriesTabProps) {
  /* Flatten every authorized story into one serializable list, newest first. */
  const dated = feed.flatMap((slot) =>
    slot.stories.map((story) => {
      // Recency for ordering: most-recently approved (or created) first.
      const sortDate = story.approvedAt ?? story.createdAt;
      // The event era the story is ABOUT (when known) — distinct from when it was recorded.
      const hasEra = story.eraYear != null;
      const item: StoryItem = {
        id: story.id,
        title: story.title ?? hub.stories.untitled,
        summary: story.summary ?? null,
        prose: story.prose ?? null,
        tags: story.tags ?? [],
        personId: slot.person.id,
        personName: slot.person.spokenName,
        eventLabel: hasEra ? eraLabelOf(story.eraYear!, story.eraLabel ?? null) : null,
        recordedLabel: recordedLabelOf(story.createdAt),
        decade: hasEra ? eraDecade(story.eraYear!) : decadeOf(sortDate),
        // New to this viewer until opened — but a narrator's own stories are never "new" to them.
        isNew: slot.person.id !== viewerPersonId && !seenStoryIds.has(story.id),
        href: `/hub/stories/${story.id}`,
        mediaSrc: `/api/media/${story.recordingMediaId}`,
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

  /* Derive facets from the real data only. */
  const personMap = new Map<string, string>();
  const decadeSet = new Set<string>();
  const topicSet = new Set<string>();
  for (const it of items) {
    personMap.set(it.personId, it.personName);
    decadeSet.add(it.decade);
    for (const t of it.tags) topicSet.add(t);
  }

  const facets: StoryFacets = {
    persons: [...personMap].map(([id, name]) => ({ id, name })),
    decades: [...decadeSet].sort(),
    topics: [...topicSet].sort(),
  };

  return <StoriesBrowser items={items} facets={facets} />;
}
