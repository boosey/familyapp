// @vitest-environment jsdom
/**
 * Story tab feed layout toggle — a right-justified Column / Masonry control on the same row as the
 * Feed/Timeline/Search mode pills. "Column" is today's single stacked column of wide cards; "Masonry"
 * lays the same cards out as a CSS multi-column. The toggle is Feed-only (Timeline/Search own their
 * layouts) and its choice persists to localStorage.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoryBrowse } from "@/app/hub/tabs/StoryBrowse";
import { hub } from "@/app/_copy";
import type { StoryItem, ViewerFamily } from "@/app/hub/tabs/story-browse-types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

const famA: ViewerFamily = { id: "fam-a", name: "Esposito" };

function makeItem(id: string): StoryItem {
  return {
    id,
    title: `Story ${id}`,
    summary: null,
    prose: null,
    tags: [],
    personId: "p1",
    personName: "Eleanor",
    eraYear: null,
    eraLabel: null,
    eventLabel: null,
    families: [famA],
    isNew: false,
    coverPhotoId: null,
    photoIds: [],
    href: `/hub/stories/${id}`,
  };
}

function renderBrowse() {
  return render(
    <StoryBrowse
      items={[makeItem("s1"), makeItem("s2")]}
      viewerFamilies={[famA]}
      viewerPersonId="p1"
      viewerName="You"
      selectedIds={[famA.id]}
      allSelected={true}
    />,
  );
}

describe("StoryBrowse — Column/Masonry feed view toggle", () => {
  it("defaults to Column and renders a column-layout feed", () => {
    const { container } = renderBrowse();
    const group = screen.getByRole("radiogroup", { name: hub.browse.viewSelectorAria });
    const column = screen.getByRole("radio", { name: hub.browse.viewColumn });
    expect(group).toBeTruthy();
    expect(column.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[data-view="column"]')).toBeTruthy();
    expect(container.querySelector('[data-view="masonry"]')).toBeNull();
  });

  it("switching to Masonry swaps the feed container to the masonry layout", () => {
    const { container } = renderBrowse();
    fireEvent.click(screen.getByRole("radio", { name: hub.browse.viewMasonry }));
    expect(container.querySelector('[data-view="masonry"]')).toBeTruthy();
    expect(container.querySelector('[data-view="column"]')).toBeNull();
    // …and the choice is persisted for next time.
    expect(window.localStorage.getItem("hub:feedView")).toBe("masonry");
  });

  it("hides the layout toggle outside Feed mode (Timeline / Search own their layouts)", () => {
    renderBrowse();
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: hub.browse.modeTimeline }));
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: hub.browse.modeSearch }));
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeNull();
  });

  it("renders the Tell-a-story CTA as the FIRST item of the feed (Column and Masonry)", () => {
    const { container } = renderBrowse();
    // Column: the feed container's first link is the /hub/tell CTA, ahead of the story cards.
    const col = container.querySelector('[data-view="column"]')!;
    expect(col.querySelector("a")?.getAttribute("href")).toBe("/hub/tell");

    fireEvent.click(screen.getByRole("radio", { name: hub.browse.viewMasonry }));
    const mas = container.querySelector('[data-view="masonry"]')!;
    expect(mas.querySelector("a")?.getAttribute("href")).toBe("/hub/tell");
  });

  it("restores a persisted Masonry choice on mount", () => {
    window.localStorage.setItem("hub:feedView", "masonry");
    const { container } = renderBrowse();
    expect(container.querySelector('[data-view="masonry"]')).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: hub.browse.viewMasonry }).getAttribute("aria-checked"),
    ).toBe("true");
  });
});
