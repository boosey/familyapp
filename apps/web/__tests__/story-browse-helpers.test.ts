/**
 * Unit tests for the pure Story Browse helpers: decade grouping (incl. the always-present Undated
 * bucket and chronological ordering) and the search-summary highlight split.
 */
import { describe, expect, it } from "vitest";
import {
  formatStoryDate,
  groupByDecade,
  highlightMatch,
  initials,
  matchesQuery,
  resolveCoverPhotoId,
  resolveGalleryPhotoIds,
  timelineBase,
  type StoryDate,
} from "../app/hub/tabs/story-browse-helpers";
import type { StoryItem } from "../app/hub/tabs/story-browse-types";

function makeItem(over: Partial<StoryItem> & { id: string }): StoryItem {
  return {
    id: over.id,
    title: over.title ?? "Untitled",
    summary: over.summary ?? null,
    prose: over.prose ?? null,
    tags: over.tags ?? [],
    personId: over.personId ?? "p1",
    personName: over.personName ?? "Someone",
    eraYear: over.eraYear ?? null,
    eraLabel: over.eraLabel ?? null,
    eventLabel: over.eventLabel ?? null,
    occurredLabel: over.occurredLabel ?? null,
    families: over.families ?? [],
    isNew: over.isNew ?? false,
    coverPhotoId: over.coverPhotoId ?? null,
    photoIds: over.photoIds ?? [],
    href: over.href ?? `/hub/stories/${over.id}`,
  };
}

describe("formatStoryDate (ADR-0026 smart display)", () => {
  const cases: Array<{ name: string; input: StoryDate | null; expected: string }> = [
    { name: "undated (null) → Undated", input: null, expected: "Undated" },
    {
      name: "exact date → formatted date",
      input: { kind: "date", date: "1943-12-25" },
      expected: "December 25, 1943",
    },
    {
      name: "exact date, single-digit month/day → no padding artifacts",
      input: { kind: "date", date: "1943-02-05" },
      expected: "February 5, 1943",
    },
    {
      name: "circa → c. year",
      input: { kind: "circa", date: "1949-06-15" },
      expected: "c. 1949",
    },
    {
      name: "year-aligned period → bare year",
      input: { kind: "period", date: "1943-01-01", endDate: "1943-12-31" },
      expected: "1943",
    },
    {
      name: "month-aligned period (31-day month) → Month YYYY",
      input: { kind: "period", date: "1943-12-01", endDate: "1943-12-31" },
      expected: "December 1943",
    },
    {
      name: "month-aligned period (30-day month) → Month YYYY",
      input: { kind: "period", date: "1951-09-01", endDate: "1951-09-30" },
      expected: "September 1951",
    },
    {
      name: "month-aligned period (leap February) → Month YYYY",
      input: { kind: "period", date: "1944-02-01", endDate: "1944-02-29" },
      expected: "February 1944",
    },
    {
      name: "decade-aligned period → the YYY0s",
      input: { kind: "period", date: "1940-01-01", endDate: "1949-12-31" },
      expected: "the 1940s",
    },
    {
      name: "unaligned period → Mon YYYY – Mon YYYY",
      input: { kind: "period", date: "1951-09-05", endDate: "1955-06-15" },
      expected: "Sep 1951 – Jun 1955",
    },
    {
      name: "period spanning one day renders as that date",
      input: { kind: "period", date: "1943-12-25", endDate: "1943-12-25" },
      expected: "December 25, 1943",
    },
    {
      name: "period without an end date degrades to its start point",
      input: { kind: "period", date: "1943-12-25", endDate: null },
      expected: "December 25, 1943",
    },
    {
      name: "malformed date → Undated (never throws)",
      input: { kind: "date", date: "not-a-date" },
      expected: "Undated",
    },
  ];

  it.each(cases)("$name", ({ input, expected }) => {
    expect(formatStoryDate(input)).toBe(expected);
  });
});

describe("groupByDecade", () => {
  it("groups dated stories by decade ascending, drops empty decades, and separates the undated", () => {
    const items = [
      makeItem({ id: "a", eraYear: 1958 }),
      makeItem({ id: "b", eraYear: 2005 }),
      makeItem({ id: "c", eraYear: 1963 }),
      makeItem({ id: "u1", eraYear: null }),
    ];
    const { groups, undated } = groupByDecade(items);

    expect(groups.map((g) => g.label)).toEqual(["1950s", "1960s", "2000s"]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["a"]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(["c"]);
    expect(groups[2]!.items.map((i) => i.id)).toEqual(["b"]);
    expect(undated.map((i) => i.id)).toEqual(["u1"]);
  });

  it("orders stories within a decade ascending by era year", () => {
    const items = [
      makeItem({ id: "later", eraYear: 1968 }),
      makeItem({ id: "earlier", eraYear: 1961 }),
      makeItem({ id: "mid", eraYear: 1965 }),
    ];
    const { groups } = groupByDecade(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["earlier", "mid", "later"]);
  });

  it("returns an empty undated bucket (not undefined) when every story is dated", () => {
    const { groups, undated } = groupByDecade([makeItem({ id: "a", eraYear: 1980 })]);
    expect(groups).toHaveLength(1);
    expect(undated).toEqual([]);
  });

  it("returns no groups but keeps the undated stories when nothing is dated", () => {
    const { groups, undated } = groupByDecade([
      makeItem({ id: "u1", eraYear: null }),
      makeItem({ id: "u2", eraYear: null }),
    ]);
    expect(groups).toEqual([]);
    expect(undated.map((i) => i.id)).toEqual(["u1", "u2"]);
  });
});

describe("highlightMatch", () => {
  it("splits the summary around a match", () => {
    expect(highlightMatch("The bakery on Magazine Street", "bakery")).toEqual({
      before: "The ",
      match: "bakery",
      after: " on Magazine Street",
    });
  });

  it("is case-insensitive but preserves the summary's original casing in the match", () => {
    expect(highlightMatch("The Bakery on Magazine Street", "bakery")).toEqual({
      before: "The ",
      match: "Bakery",
      after: " on Magazine Street",
    });
  });

  it("returns null when the query is not present in the summary", () => {
    expect(highlightMatch("The bakery on Magazine Street", "levee")).toBeNull();
  });

  it("returns null for an absent summary or an empty/whitespace query", () => {
    expect(highlightMatch(null, "bakery")).toBeNull();
    expect(highlightMatch("The bakery", "")).toBeNull();
    expect(highlightMatch("The bakery", "   ")).toBeNull();
  });
});

describe("initials", () => {
  it("takes up to two leading initials, uppercased", () => {
    expect(initials("Eleanor Boudreaux")).toBe("EB");
    expect(initials("marco")).toBe("M");
    expect(initials("Anna Maria Rossi")).toBe("AM");
  });

  it("falls back to '?' for an empty name", () => {
    expect(initials("   ")).toBe("?");
  });
});

describe("timelineBase", () => {
  it("returns every story when widened to the whole family", () => {
    const items = [
      makeItem({ id: "a", personId: "p1" }),
      makeItem({ id: "b", personId: "p2" }),
    ];
    expect(timelineBase(items, true, "p1").map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("narrows to the viewer's own stories by person id", () => {
    const items = [
      makeItem({ id: "a", personId: "p1" }),
      makeItem({ id: "b", personId: "p2" }),
    ];
    expect(timelineBase(items, false, "p1").map((i) => i.id)).toEqual(["a"]);
  });

  it("REGRESSION: narrows by person id, not display name — namesake narrators stay separate", () => {
    // Two different people who happen to share a spoken name ("Mom"). Filtering by name would merge
    // them; filtering by the stable person id keeps only the viewer's own story.
    const items = [
      makeItem({ id: "mine", personId: "viewer", personName: "Mom" }),
      makeItem({ id: "namesake", personId: "other", personName: "Mom" }),
    ];
    const own = timelineBase(items, false, "viewer");
    expect(own.map((i) => i.id)).toEqual(["mine"]);
  });
});

describe("resolveCoverPhotoId", () => {
  it("returns the family_photo_id for a story that has a cover in the map", () => {
    const covers = new Map<string, string>([
      ["s1", "photo-1"],
      ["s2", "photo-2"],
    ]);
    expect(resolveCoverPhotoId(covers, "s1")).toBe("photo-1");
    expect(resolveCoverPhotoId(covers, "s2")).toBe("photo-2");
  });

  it("returns null for a story with no cover entry (text-only card, no placeholder)", () => {
    const covers = new Map<string, string>([["s1", "photo-1"]]);
    expect(resolveCoverPhotoId(covers, "s-none")).toBeNull();
    expect(resolveCoverPhotoId(new Map(), "s1")).toBeNull();
  });

  it("maps a covers map onto StoryItem.coverPhotoId the way StoriesTab does", () => {
    const covers = new Map<string, string>([["with", "cover-x"]]);
    const withCover = makeItem({ id: "with", coverPhotoId: resolveCoverPhotoId(covers, "with") });
    const without = makeItem({ id: "without", coverPhotoId: resolveCoverPhotoId(covers, "without") });
    expect(withCover.coverPhotoId).toBe("cover-x");
    expect(without.coverPhotoId).toBeNull();
  });
});

describe("resolveGalleryPhotoIds", () => {
  it("returns the ordered photo id list for a story that has photos in the map", () => {
    const photos = new Map<string, string[]>([
      ["s1", ["cover", "p2", "p3"]],
      ["s2", ["only"]],
    ]);
    expect(resolveGalleryPhotoIds(photos, "s1")).toEqual(["cover", "p2", "p3"]);
    expect(resolveGalleryPhotoIds(photos, "s2")).toEqual(["only"]);
  });

  it("returns an empty array for a story with no photos (text-only card, no thumbnail row)", () => {
    const photos = new Map<string, string[]>([["s1", ["cover"]]]);
    expect(resolveGalleryPhotoIds(photos, "s-none")).toEqual([]);
    expect(resolveGalleryPhotoIds(new Map(), "s1")).toEqual([]);
  });
});

describe("matchesQuery", () => {
  it("matches across title, summary, prose, narrator, era/place labels, and tags", () => {
    const item = makeItem({
      id: "a",
      title: "Nine days on the Saturnia",
      summary: "Seasick the whole crossing.",
      prose: "I was seasick nearly the whole way over.",
      personName: "Eleanor",
      eventLabel: "1961 · AT SEA",
      eraLabel: "At sea",
      tags: ["immigration"],
    });
    expect(matchesQuery(item, "saturnia")).toBe(true); // title
    expect(matchesQuery(item, "seasick")).toBe(true); // summary / prose
    expect(matchesQuery(item, "eleanor")).toBe(true); // narrator
    expect(matchesQuery(item, "at sea")).toBe(true); // era/place label
    expect(matchesQuery(item, "immigration")).toBe(true); // tag
    expect(matchesQuery(item, "levee")).toBe(false);
    expect(matchesQuery(item, "   ")).toBe(false);
  });
});
