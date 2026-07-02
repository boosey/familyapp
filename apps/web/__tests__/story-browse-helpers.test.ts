/**
 * Unit tests for the pure Story Browse helpers: decade grouping (incl. the always-present Undated
 * bucket and chronological ordering) and the search-summary highlight split.
 */
import { describe, expect, it } from "vitest";
import {
  groupByDecade,
  highlightMatch,
  initials,
  matchesQuery,
  timelineBase,
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
    families: over.families ?? [],
    isNew: over.isNew ?? false,
    href: over.href ?? `/hub/stories/${over.id}`,
  };
}

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
