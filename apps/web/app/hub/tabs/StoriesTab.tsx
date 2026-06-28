import { StoriesBrowser, type StoryItem, type StoryFacets } from "./StoriesBrowser";
import type { MemberWithStories } from "@/lib/hub-data";

interface StoriesTabProps {
  feed: MemberWithStories[];
}

function formatDateLabel(d: Date): string {
  const year = d.getFullYear();
  const month = d.toLocaleString(undefined, { month: "long" }).toUpperCase();
  return `${year} · ${month}`;
}

function decadeOf(d: Date): string {
  return `${Math.floor(d.getFullYear() / 10) * 10}s`;
}

/** The era a story is ABOUT, when known, beats the recording date. */
function eraDateLabel(eraYear: number, eraLabel: string | null): string {
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
export function StoriesTab({ feed }: StoriesTabProps) {
  /* Flatten every authorized story into one serializable list, newest first. */
  const dated = feed.flatMap((slot) =>
    slot.stories.map((story) => {
      const date = story.approvedAt ?? story.createdAt;
      // Prefer the historical era the story is ABOUT; fall back to the recording date.
      const hasEra = story.eraYear != null;
      const item: StoryItem = {
        id: story.id,
        title: story.title ?? "Untitled",
        summary: story.summary ?? null,
        prose: story.prose ?? null,
        tags: story.tags ?? [],
        personId: slot.person.id,
        personName: slot.person.spokenName,
        dateLabel: hasEra
          ? eraDateLabel(story.eraYear!, story.eraLabel ?? null)
          : formatDateLabel(date),
        decade: hasEra ? eraDecade(story.eraYear!) : decadeOf(date),
        href: `/hub/stories/${story.id}`,
        mediaSrc: `/api/media/${story.recordingMediaId}`,
      };
      return { item, sort: date.getTime() };
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
        No stories yet. When someone shares a chronicle with you, their stories will appear here.
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

  /* One narrator → name it; several → generic. */
  const contextLabel =
    facets.persons.length === 1
      ? `${facets.persons[0]!.name}’s stories · shared with you`
      : "Shared with you";

  return <StoriesBrowser items={items} facets={facets} contextLabel={contextLabel} />;
}
