// @vitest-environment jsdom
/**
 * Issue #47 — the Stories browse surface honours the shared `?families=` multi-select family filter
 * (ADR-0021), reusing `family-filter.ts` + the `<FamilyChips>` widget exactly as the album does.
 *
 * StoryBrowse narrows its already-deduped, already-authorized pool by a `selectedIds` set (a story is
 * shown when ANY of its families is selected) with an `allSelected` short-circuit; the empty selection
 * (`none`) is handled UPSTREAM in StoriesTab (an honest empty state, not the full pool). These tests
 * cover the narrowing ACROSS all three browse modes (Feed / Timeline / Search), plus the StoriesTab
 * chip-bar gating (present for ≥2 families, absent for <2) and the all-off empty state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoryBrowse } from "@/app/hub/tabs/StoryBrowse";
import { StoriesTab } from "@/app/hub/tabs/StoriesTab";
import type { FamilyFilter } from "@/lib/family-filter";
import type { MemberWithStories } from "@/lib/hub-data";
import type { StoryItem, ViewerFamily } from "@/app/hub/tabs/story-browse-types";
import { hub } from "@/app/_copy";

// StoryBrowse reads only the initial browse MODE from the URL; the family filter is a prop now.
// FamilyChips (mounted by StoriesTab for ≥2 families) also needs useRouter/usePathname.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

const famA: ViewerFamily = { id: "fam-a", name: "Esposito" };
const famB: ViewerFamily = { id: "fam-b", name: "Marino" };

function makeItem(over: Partial<StoryItem> & { id: string }): StoryItem {
  return {
    id: over.id,
    title: over.title ?? over.id,
    summary: over.summary ?? null,
    prose: over.prose ?? null,
    tags: over.tags ?? [],
    personId: over.personId ?? "p1",
    personName: over.personName ?? "Eleanor",
    eraYear: over.eraYear ?? null,
    eraLabel: over.eraLabel ?? null,
    eventLabel: over.eventLabel ?? null,
    families: over.families ?? [],
    isNew: over.isNew ?? false,
    coverPhotoId: over.coverPhotoId ?? null,
    photoIds: over.photoIds ?? [],
    href: over.href ?? `/hub/stories/${over.id}`,
  };
}

/** A story targeting BOTH families, one targeting only A, one targeting only B — with era years so
 *  they land in the dated Timeline sections (not the always-present Undated section). */
const both = makeItem({ id: "s-AB", title: "Story AB", families: [famA, famB], eraYear: 1962, summary: "wedding" });
const onlyA = makeItem({ id: "s-A", title: "Story A only", families: [famA], eraYear: 1971, summary: "the storm" });
const onlyB = makeItem({ id: "s-B", title: "Story B only", families: [famB], eraYear: 1988, summary: "the move" });
const items = [both, onlyA, onlyB];

/** Render StoryBrowse with an explicit selected-id set (mode is switched via the sub-nav tabs). */
function renderBrowse(selectedIds: string[], allSelected: boolean) {
  return render(
    <StoryBrowse
      items={items}
      viewerFamilies={[famA, famB]}
      viewerPersonId="p1"
      viewerName="You"
      selectedIds={selectedIds}
      allSelected={allSelected}
    />,
  );
}

/** Titles of the story cards/rows currently on screen (each links to its story). */
function shownTitles(): string[] {
  return screen
    .queryAllByRole("link")
    .map((el) => el.textContent ?? "")
    .filter((t) => t.includes("Story"));
}

function switchMode(mode: "timeline" | "search") {
  const name = mode === "timeline" ? hub.browse.modeTimeline : hub.browse.modeSearch;
  fireEvent.click(screen.getByRole("tab", { name }));
}

// The Search mode only lists results once a query is typed; type a substring that all three summaries
// contain via the shared word "the" would over-match, so search each explicitly by title token below.
function typeSearch(q: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: q } });
}

describe("StoryBrowse — family tag labels", () => {
  it("a story card's family tag shows the steward-set short name in place of the formal name (ADR-0021)", () => {
    const shortFam: ViewerFamily = { id: "fam-s", name: "The Esposito Family", shortName: "Espositos" };
    const item = makeItem({ id: "s-short", title: "Story short", families: [shortFam], eraYear: 1962 });
    render(
      <StoryBrowse
        items={[item]}
        viewerFamilies={[shortFam]}
        viewerPersonId="p1"
        viewerName="You"
        selectedIds={[shortFam.id]}
        allSelected
      />,
    );
    expect(screen.getByText("Espositos")).toBeTruthy();
    expect(screen.queryByText("The Esposito Family")).toBeNull();
  });
});

describe("StoryBrowse — multi-select family narrowing (Feed)", () => {
  it("all selected shows every story (A+B, A-only, B-only)", () => {
    renderBrowse([famA.id, famB.id], true);
    const titles = shownTitles();
    expect(titles.some((t) => t.includes("Story AB"))).toBe(true);
    expect(titles.some((t) => t.includes("Story A only"))).toBe(true);
    expect(titles.some((t) => t.includes("Story B only"))).toBe(true);
  });

  it("only A selected: A+B and A-only show; B-only is hidden", () => {
    renderBrowse([famA.id], false);
    const titles = shownTitles();
    expect(titles.some((t) => t.includes("Story AB"))).toBe(true);
    expect(titles.some((t) => t.includes("Story A only"))).toBe(true);
    expect(titles.some((t) => t.includes("Story B only"))).toBe(false);
  });

  it("only B selected: A+B and B-only show; A-only is hidden", () => {
    renderBrowse([famB.id], false);
    const titles = shownTitles();
    expect(titles.some((t) => t.includes("Story AB"))).toBe(true);
    expect(titles.some((t) => t.includes("Story B only"))).toBe(true);
    expect(titles.some((t) => t.includes("Story A only"))).toBe(false);
  });

  it("a story targeting A+B appears exactly ONCE under a single-family selection (no double-listing)", () => {
    renderBrowse([famA.id], false);
    const ab = shownTitles().filter((t) => t.includes("Story AB"));
    expect(ab).toHaveLength(1);
  });

  it("a MULTI-family subset (≥2 selected) with an empty resulting feed uses the generic 'your families' empty copy, never a single family name", () => {
    // A ≥2-family subset selection whose narrowed feed is empty must fall to the generic empty copy
    // (`selectedIds.length !== 1`), never mis-name a single family (MINOR-2 regression guard).
    render(
      <StoryBrowse
        items={[]}
        viewerFamilies={[famA, famB]}
        viewerPersonId="p1"
        viewerName="You"
        selectedIds={[famA.id, famB.id]}
        allSelected={false}
      />,
    );
    expect(screen.getByText(hub.browse.feedEmpty(hub.browse.scopeNameAll))).toBeTruthy();
    expect(
      screen.queryByText(hub.browse.feedEmpty(hub.browse.scopeNameFamily(famA.name))),
    ).toBeNull();
  });
});

describe("StoryBrowse — multi-select family narrowing (Timeline)", () => {
  it("only A selected hides the B-only story in the timeline", () => {
    renderBrowse([famA.id], false);
    switchMode("timeline");
    const titles = shownTitles();
    expect(titles.some((t) => t.includes("Story AB"))).toBe(true);
    expect(titles.some((t) => t.includes("Story A only"))).toBe(true);
    expect(titles.some((t) => t.includes("Story B only"))).toBe(false);
  });

  it("all selected shows every story in the timeline", () => {
    renderBrowse([famA.id, famB.id], true);
    switchMode("timeline");
    const titles = shownTitles();
    expect(titles.some((t) => t.includes("Story B only"))).toBe(true);
  });
});

describe("StoryBrowse — multi-select family narrowing (Search)", () => {
  it("only A selected: the B-only story is not searchable, the A-only story is", () => {
    renderBrowse([famA.id], false);
    switchMode("search");
    // "the" appears in both onlyA ("the storm") and onlyB ("the move") summaries — the pool is narrowed
    // BEFORE search, so a B-only match must not surface under an A-only selection.
    typeSearch("the");
    const titles = shownTitles();
    expect(titles.some((t) => t.includes("Story A only"))).toBe(true);
    expect(titles.some((t) => t.includes("Story B only"))).toBe(false);
  });

  it("all selected: both the A-only and B-only stories are searchable", () => {
    renderBrowse([famA.id, famB.id], true);
    switchMode("search");
    typeSearch("the");
    const titles = shownTitles();
    expect(titles.some((t) => t.includes("Story A only"))).toBe(true);
    expect(titles.some((t) => t.includes("Story B only"))).toBe(true);
  });
});

/* ── StoriesTab — chip bar gating + all-off empty state ──────────────────────────── */

/** One MemberWithStories slot for a family, carrying a single approved story. */
function slot(familyId: string, familyName: string, storyId: string, title: string): MemberWithStories {
  const now = new Date();
  return {
    person: { id: "p1", spokenName: "Eleanor", displayName: "Eleanor" },
    family: { id: familyId, name: familyName },
    stories: [
      {
        id: storyId,
        title,
        summary: null,
        prose: null,
        tags: [],
        eraYear: null,
        eraLabel: null,
        approvedAt: now,
        createdAt: now,
      },
    ],
  } as unknown as MemberWithStories;
}

function renderTab(opts: {
  filter: FamilyFilter;
  activeFamilies: ViewerFamily[];
}) {
  return render(
    <StoriesTab
      feed={[slot(famA.id, famA.name, "s-AB", "Story AB")]}
      viewerPersonId="viewer"
      seenStoryIds={new Set<string>()}
      familyTargets={new Map([["s-AB", [famA, famB]]])}
      storyCovers={new Map<string, string>()}
      storyPhotos={new Map<string, string[]>()}
      viewerFamilies={opts.activeFamilies}
      viewerName="You"
      selfDrafts={[]}
      filter={opts.filter}
      activeFamilies={opts.activeFamilies}
    />,
  );
}

describe("StoriesTab — family filter chip bar", () => {
  it("renders the chip bar (one chip per family) for a viewer with ≥2 families", () => {
    renderTab({ filter: { kind: "all" }, activeFamilies: [famA, famB] });
    expect(screen.getByRole("group", { name: hub.shell.familyFilterAria })).toBeTruthy();
    expect(screen.getByRole("button", { name: famA.name })).toBeTruthy();
    expect(screen.getByRole("button", { name: famB.name })).toBeTruthy();
  });

  it("renders NO chip bar for a single-family viewer", () => {
    renderTab({ filter: { kind: "all" }, activeFamilies: [famA] });
    expect(screen.queryByRole("group", { name: hub.shell.familyFilterAria })).toBeNull();
    expect(screen.queryByRole("button", { name: famA.name })).toBeNull();
  });

  it("renders NO chip bar for a family-less viewer", () => {
    renderTab({ filter: { kind: "all" }, activeFamilies: [] });
    expect(screen.queryByRole("group", { name: hub.shell.familyFilterAria })).toBeNull();
  });

  it("all-off (filter=none) shows the honest empty state, NOT the pool, with the chips still visible", () => {
    renderTab({ filter: { kind: "none" }, activeFamilies: [famA, famB] });
    // Empty-state copy present; the browse pool (the story card) is absent.
    expect(screen.getByText(hub.stories.noFamiliesSelected)).toBeTruthy();
    expect(
      screen.queryAllByRole("link").filter((el) => (el.textContent ?? "").includes("Story AB")),
    ).toHaveLength(0);
    // The chip bar stays so the viewer can turn a family back on.
    expect(screen.getByRole("group", { name: hub.shell.familyFilterAria })).toBeTruthy();
  });

  it("filter=all renders the browse pool (the story card) below the chips", () => {
    renderTab({ filter: { kind: "all" }, activeFamilies: [famA, famB] });
    expect(
      screen.queryAllByRole("link").some((el) => (el.textContent ?? "").includes("Story AB")),
    ).toBe(true);
  });
});

describe("StoriesTab — dedups the feed union by story id", () => {
  it("shows a story present in two family slots exactly once", () => {
    render(
      <StoriesTab
        feed={[slot(famA.id, famA.name, "dup-1", "Story Shared"), slot(famB.id, famB.name, "dup-1", "Story Shared")]}
        viewerPersonId="viewer"
        seenStoryIds={new Set<string>()}
        familyTargets={new Map([["dup-1", [famA, famB]]])}
        storyCovers={new Map<string, string>()}
        storyPhotos={new Map<string, string[]>()}
        viewerFamilies={[famA, famB]}
        viewerName="You"
        selfDrafts={[]}
        filter={{ kind: "all" }}
        activeFamilies={[famA, famB]}
      />,
    );
    const shared = screen
      .queryAllByRole("link")
      .filter((el) => (el.textContent ?? "").includes("Story Shared"));
    expect(shared).toHaveLength(1);
  });
});
