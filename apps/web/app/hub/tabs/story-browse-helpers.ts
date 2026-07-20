/**
 * Pure helpers for the Story Browse surface (Feed / Timeline / Search). Kept free of React and of
 * any DOM/query dependency so they can be unit-tested in isolation (see
 * apps/web/__tests__/story-browse-helpers.test.ts).
 */
import type { OccurredKind } from "@chronicle/db";
import { hub } from "@/app/_copy";
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

// ---------------------------------------------------------------------------
// Story date display (ADR-0026)
// ---------------------------------------------------------------------------

/** A Story date as the read path carries it: the form plus ISO calendar dates (YYYY-MM-DD). */
export interface StoryDate {
  kind: OccurredKind;
  /** The point for `date`/`circa`; the span start for `period`. */
  date: string;
  /** The span end — set only for `period`. */
  endDate?: string | null;
}

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const MONTH_SHORT = MONTH_LONG.map((m) => m.slice(0, 3));

/** Parse an ISO calendar date (YYYY-MM-DD) into parts, or null when malformed. Parsed by hand so
 *  no Date/timezone conversion can shift the day. */
function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const parts = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) return null;
  return parts;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "December 25, 1943" — the full point form. */
function formatPoint(p: { y: number; m: number; d: number }): string {
  return `${MONTH_LONG[p.m - 1]} ${p.d}, ${p.y}`;
}

/**
 * The smart-display label for a Story date (ADR-0026): never claims more precision than the form
 * carries. Exact date → "December 25, 1943"; period aligned to a year → "1943", to a month →
 * "December 1943", to a decade → "the 1940s", any other span → "Sep 1951 – Jun 1955"; circa →
 * "c. 1949"; null (or an unparseable value) → Undated.
 */
export function formatStoryDate(occurred: StoryDate | null): string {
  if (!occurred) return hub.browse.undated;
  const start = parseIsoDate(occurred.date);
  if (!start) return hub.browse.undated;

  if (occurred.kind === "date") return formatPoint(start);
  if (occurred.kind === "circa") return `c. ${start.y}`;

  // period
  const end = occurred.endDate ? parseIsoDate(occurred.endDate) : null;
  if (!end || end.y < start.y || (end.y === start.y && (end.m < start.m || (end.m === start.m && end.d < start.d)))) {
    // Defensive: a period without a usable end renders as its start point.
    return formatPoint(start);
  }
  if (start.y === end.y && start.m === end.m && start.d === end.d) return formatPoint(start);
  if (start.m === 1 && start.d === 1 && end.m === 12 && end.d === 31) {
    if (start.y === end.y) return `${start.y}`;
    if (start.y % 10 === 0 && end.y === start.y + 9) return `the ${start.y}s`;
  }
  if (
    start.y === end.y &&
    start.m === end.m &&
    start.d === 1 &&
    end.d === lastDayOfMonth(end.y, end.m)
  ) {
    return `${MONTH_LONG[start.m - 1]} ${start.y}`;
  }
  return `${MONTH_SHORT[start.m - 1]} ${start.y} – ${MONTH_SHORT[end.m - 1]} ${end.y}`;
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

/**
 * The cover accompaniment photo id for a story (ADR-0009 Phase 2), from the batched `loadStoryCovers`
 * map keyed by story id. Returns the `family_photo_id` when the story has a (non-deleted) cover, else
 * `null` — a text-only card is first-class and renders no placeholder. Kept pure + named so the
 * mapping into `StoryItem.coverPhotoId` is unit-testable.
 */
export function resolveCoverPhotoId(
  storyCovers: Map<string, string>,
  storyId: string,
): string | null {
  return storyCovers.get(storyId) ?? null;
}

/**
 * All of a story's renderable accompaniment photo ids (ADR-0009 Phase 2), from the batched
 * `loadStoryGalleryPhotoIds` map keyed by story id. Returns the ordered array (cover first) when the
 * story has photos, else an empty array — a text-only card renders no thumbnail row. Kept pure + named
 * so the mapping into `StoryItem.photoIds` is unit-testable.
 */
export function resolveGalleryPhotoIds(
  storyPhotos: Map<string, string[]>,
  storyId: string,
): string[] {
  return storyPhotos.get(storyId) ?? [];
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
