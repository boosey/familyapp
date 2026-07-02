/**
 * Pure helpers for the Story Browse surface (Feed / Timeline / Search). Kept free of React and of
 * any DOM/query dependency so they can be unit-tested in isolation (see
 * apps/web/__tests__/story-browse-helpers.test.ts).
 */
import type { StoryItem } from "./story-browse-types";

/** A decade bucket for the Timeline, e.g. label "1950s" holding the stories about that decade. */
export interface DecadeGroup {
  /** Mono uppercase decade label, e.g. "1950s". */
  label: string;
  /** Stories about that decade, ascending by era year (chronological within the decade). */
  items: StoryItem[];
}

/** The Timeline split: dated stories grouped by decade (ascending, empty decades dropped) and the
 *  always-shown Undated bucket (stories with `eraYear === null`). */
export interface TimelineGroups {
  groups: DecadeGroup[];
  undated: StoryItem[];
}

/** A summary snippet split around a matched query, for the search-result highlight. */
export interface Highlight {
  before: string;
  match: string;
  after: string;
}

/** Up to two leading initials, uppercased, e.g. "Eleanor Boudreaux" → "EB". Falls back to "?". */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return letters || "?";
}

/** The decade label a story's era falls in, e.g. 1958 → "1950s". */
function decadeLabelOf(eraYear: number): string {
  return `${Math.floor(eraYear / 10) * 10}s`;
}

/**
 * Split `items` into decade groups (dated) and the Undated bucket. Dated stories are grouped by the
 * decade of `eraYear`, groups are ordered ascending, empty decades are dropped, and stories within a
 * decade are ordered ascending by era year. Undated stories (`eraYear === null`) keep their incoming
 * order (the feed's reverse-chronological order).
 */
export function groupByDecade(items: StoryItem[]): TimelineGroups {
  const undated: StoryItem[] = [];
  const byDecade = new Map<string, StoryItem[]>();

  for (const item of items) {
    if (item.eraYear === null) {
      undated.push(item);
      continue;
    }
    const label = decadeLabelOf(item.eraYear);
    const bucket = byDecade.get(label);
    if (bucket) bucket.push(item);
    else byDecade.set(label, [item]);
  }

  const groups: DecadeGroup[] = [...byDecade.entries()]
    // Ascending by the numeric decade (label is "<num>s").
    .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
    .map(([label, bucket]) => ({
      label,
      // Non-null era years within a dated bucket; ascending, stable for equal years.
      items: [...bucket].sort((a, b) => (a.eraYear ?? 0) - (b.eraYear ?? 0)),
    }));

  return { groups, undated };
}

/**
 * Locate `query` (trimmed, case-insensitive) inside `summary` and return the surrounding text split
 * around the matched substring. Returns null when the summary is absent, the query is empty, or the
 * match is not present in the summary — the caller then renders the summary without a highlight.
 */
export function highlightMatch(summary: string | null, query: string): Highlight | null {
  if (!summary) return null;
  const q = query.trim();
  if (!q) return null;
  const idx = summary.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;
  return {
    before: summary.slice(0, idx),
    match: summary.slice(idx, idx + q.length),
    after: summary.slice(idx + q.length),
  };
}

/**
 * The client-side search haystack for a story: title + summary + prose + narrator + era/place labels
 * + tags, lower-cased for case-insensitive matching. Transcript is deliberately excluded — it is not
 * shipped to the browser (see StoryItem.prose docs); transcript search is a deferred server pass.
 */
export function searchHaystack(item: StoryItem): string {
  return [
    item.title,
    item.summary,
    item.prose,
    item.personName,
    item.eventLabel,
    item.eraLabel,
    ...item.tags,
  ]
    .filter((s): s is string => Boolean(s))
    .join(" ")
    .toLowerCase();
}

/** Whether a story matches the (trimmed, case-insensitive) query across its haystack. */
export function matchesQuery(item: StoryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return searchHaystack(item).includes(q);
}

/**
 * The Timeline's base set for the widen toggle: "Whole family" is every in-scope story, while
 * "Just {viewer}" is the viewer's OWN stories, narrowed on the stable `personId`. It must NOT narrow
 * on display name — `spokenName` is free-text and not unique, so namesake narrators (common in a
 * multi-generational family) would otherwise be merged together.
 */
export function timelineBase(
  items: StoryItem[],
  wholeFamily: boolean,
  viewerPersonId: string,
): StoryItem[] {
  return wholeFamily ? items : items.filter((it) => it.personId === viewerPersonId);
}
