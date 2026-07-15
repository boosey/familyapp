// @vitest-environment jsdom
/**
 * Story tab feed layout toggle — a right-justified Masonry / Column control on the same row as the
 * Feed/Timeline/Search mode pills. "Masonry" lays the cards out as a CSS multi-column (the new-viewer
 * default, listed first per ADR-0021); "Column" is a single stacked column of wide cards. The toggle
 * is Feed-only (Timeline/Search own their layouts) and its choice persists to localStorage — a stored
 * preference still wins over the default.
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
  it("defaults to Masonry for a new viewer and renders a masonry-layout feed (ADR-0021)", () => {
    const { container } = renderBrowse();
    const group = screen.getByRole("radiogroup", { name: hub.browse.viewSelectorAria });
    const masonry = screen.getByRole("radio", { name: hub.browse.viewMasonry });
    const column = screen.getByRole("radio", { name: hub.browse.viewColumn });
    expect(group).toBeTruthy();
    expect(masonry.getAttribute("aria-checked")).toBe("true");
    expect(column.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector('[data-view="masonry"]')).toBeTruthy();
    expect(container.querySelector('[data-view="column"]')).toBeNull();
  });

  it("lists the layout toggle Masonry first, then Column (ADR-0021 order)", () => {
    renderBrowse();
    const group = screen.getByRole("radiogroup", { name: hub.browse.viewSelectorAria });
    const labels = Array.from(group.querySelectorAll('[role="radio"]')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual([hub.browse.viewMasonry, hub.browse.viewColumn]);
  });

  it("switching to Column swaps the feed container to the column layout", () => {
    const { container } = renderBrowse();
    fireEvent.click(screen.getByRole("radio", { name: hub.browse.viewColumn }));
    expect(container.querySelector('[data-view="column"]')).toBeTruthy();
    expect(container.querySelector('[data-view="masonry"]')).toBeNull();
    // …and the choice is persisted for next time.
    expect(window.localStorage.getItem("hub:feedView")).toBe("column");
  });

  it("hides the layout toggle outside Feed mode (Timeline / Search own their layouts)", () => {
    renderBrowse();
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: hub.browse.modeTimeline }));
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: hub.browse.modeSearch }));
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeNull();
  });

  it("renders the Tell-a-story CTA as the FIRST item of the feed (Masonry and Column)", () => {
    const { container } = renderBrowse();
    // Masonry (default): the feed container's first link is the /hub/tell CTA, ahead of the cards.
    const mas = container.querySelector('[data-view="masonry"]')!;
    expect(mas.querySelector("a")?.getAttribute("href")).toBe("/hub/tell");

    fireEvent.click(screen.getByRole("radio", { name: hub.browse.viewColumn }));
    const col = container.querySelector('[data-view="column"]')!;
    expect(col.querySelector("a")?.getAttribute("href")).toBe("/hub/tell");
  });

  it("restores a persisted Column choice on mount (stored preference beats the Masonry default)", () => {
    window.localStorage.setItem("hub:feedView", "column");
    const { container } = renderBrowse();
    expect(container.querySelector('[data-view="column"]')).toBeTruthy();
    expect(container.querySelector('[data-view="masonry"]')).toBeNull();
    expect(
      screen.getByRole("radio", { name: hub.browse.viewColumn }).getAttribute("aria-checked"),
    ).toBe("true");
  });
});
