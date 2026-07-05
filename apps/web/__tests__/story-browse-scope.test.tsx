// @vitest-environment jsdom
/**
 * Increment 4A · Task 4.1 — the Stories browse surface honours the hub's single `scope` (owned by the
 * header selector, threaded as a CONTROLLED prop). StoryBrowse no longer reads its own `?scope=` nor
 * renders a duplicate family-scope control: it just filters the already-deduped pool by the prop.
 *
 * A story targeted to families A+B appears ONCE in "all" and in EACH of its families' scoped views;
 * a story only in A is absent when scope=B. The upstream dedup (StoriesTab) is covered separately.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StoryBrowse } from "@/app/hub/tabs/StoryBrowse";
import { StoriesTab } from "@/app/hub/tabs/StoriesTab";
import type { MemberWithStories } from "@/lib/hub-data";
import type { StoryItem, ViewerFamily } from "@/app/hub/tabs/story-browse-types";

// StoryBrowse still reads the initial browse MODE from the URL; scope is a prop now, not a query.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => {
  cleanup();
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
    href: over.href ?? `/hub/stories/${over.id}`,
  };
}

function renderScope(scope: string, items: StoryItem[]) {
  return render(
    <StoryBrowse
      items={items}
      viewerFamilies={[famA, famB]}
      viewerPersonId="p1"
      viewerName="You"
      scope={scope}
    />,
  );
}

// The default browse mode is Feed, whose cards title-link to the story — one link per shown story.
function shownTitles(): string[] {
  return screen
    .queryAllByRole("link")
    .map((el) => el.textContent ?? "")
    .filter((t) => t.includes("Story"));
}

describe("StoryBrowse — hub scope controls the family filter", () => {
  const both = makeItem({ id: "s-AB", title: "Story AB", families: [famA, famB] });
  const onlyA = makeItem({ id: "s-A", title: "Story A only", families: [famA] });
  const items = [both, onlyA];

  it("scope=all shows a story targeting A+B exactly ONCE (no double-listing)", () => {
    renderScope("all", items);
    const ab = shownTitles().filter((t) => t.includes("Story AB"));
    expect(ab).toHaveLength(1);
  });

  it("scope=A includes the A+B story and the A-only story", () => {
    renderScope(famA.id, items);
    const titles = shownTitles();
    expect(titles.some((t) => t.includes("Story AB"))).toBe(true);
    expect(titles.some((t) => t.includes("Story A only"))).toBe(true);
  });

  it("scope=B includes the A+B story but NOT the A-only story", () => {
    renderScope(famB.id, items);
    const titles = shownTitles();
    expect(titles.some((t) => t.includes("Story AB"))).toBe(true);
    expect(titles.some((t) => t.includes("Story A only"))).toBe(false);
  });

  it("renders no duplicate family-scope control (the hub header owns scope)", () => {
    renderScope("all", items);
    // The retired in-tab control rendered family-name pills as buttons; only the browse-mode tablist
    // buttons remain now. Neither family name should appear as a button label.
    const buttonLabels = screen.queryAllByRole("button").map((b) => b.textContent ?? "");
    expect(buttonLabels).not.toContain(famA.name);
    expect(buttonLabels).not.toContain(famB.name);
  });
});

describe("StoriesTab — dedups the feed union by story id", () => {
  // A synthetic union where the SAME story surfaces under two of the viewer's family slots. The
  // producer must fold it to a single card before handing the pool to StoryBrowse.
  function slot(familyId: string, familyName: string): MemberWithStories {
    const now = new Date();
    return {
      person: { id: "p1", spokenName: "Eleanor", displayName: "Eleanor" },
      family: { id: familyId, name: familyName },
      stories: [
        {
          id: "dup-1",
          title: "Story Shared",
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

  it("shows a story present in two family slots exactly once", () => {
    render(
      <StoriesTab
        feed={[slot(famA.id, famA.name), slot(famB.id, famB.name)]}
        viewerPersonId="viewer"
        seenStoryIds={new Set<string>()}
        familyTargets={new Map([["dup-1", [famA, famB]]])}
        storyCovers={new Map<string, string>()}
        viewerFamilies={[famA, famB]}
        viewerName="You"
        selfDrafts={[]}
        scope="all"
      />,
    );
    const shared = screen
      .queryAllByRole("link")
      .filter((el) => (el.textContent ?? "").includes("Story Shared"));
    expect(shared).toHaveLength(1);
  });
});
