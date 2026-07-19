// @vitest-environment jsdom
/**
 * Story tab feed layout toggle — a right-justified Masonry / Column control that (post-#190) rides the
 * shared HubToolbar's R2-right slot, alongside the Feed/Timeline mode pills in R1. "Masonry"
 * lays the cards out as a CSS multi-column (the new-viewer default, listed first per ADR-0021);
 * "Column" is a single stacked column of wide cards. The toggle is Feed-only (Timeline owns its own
 * layout; a live search replaces the feed body) and its choice persists to localStorage — a stored
 * preference still wins over the default.
 *
 * These controls live in StoriesSurface now (it owns the mode/feedView/query state that drives the
 * toolbar), so we drive them through StoriesSurface in its browse body.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoriesSurface } from "@/app/hub/tabs/StoriesSurface";
import { hub } from "@/app/_copy";
import type { StoryItem, ViewerFamily } from "@/app/hub/tabs/story-browse-types";

// StoriesSurface reads ?mode= via useSearchParams; a single-family viewer never mounts FamilyChips, so
// the router/pathname hooks are not needed here.
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
    <StoriesSurface
      items={[makeItem("s1"), makeItem("s2")]}
      viewerFamilies={[famA]}
      viewerPersonId="p1"
      viewerName="You"
      selectedIds={[famA.id]}
      allSelected={true}
      activeFamilies={[famA]}
      chipSelected="all"
      selfDrafts={[]}
      intakeIncomplete={false}
      body="browse"
      emptyCopy=""
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

  it("hides the layout toggle outside Feed mode and while searching (each owns its own layout)", () => {
    renderBrowse();
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeTruthy();

    // Timeline owns its own layout.
    fireEvent.click(screen.getByRole("button", { name: hub.browse.modeTimeline }));
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeNull();

    // Back to Feed → the toggle returns.
    fireEvent.click(screen.getByRole("button", { name: hub.browse.modeFeed }));
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeTruthy();

    // Typing in the persistent field replaces the feed body with search results → toggle hides.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "x" } });
    expect(screen.queryByRole("radiogroup", { name: hub.browse.viewSelectorAria })).toBeNull();
  });

  // (#125) The Tell-a-story CTA is no longer an in-feed item — it moved to the Stories control row
  // (StoriesControls, covered by StoriesControls.test.tsx). StoryBrowse now renders only story cards,
  // so there is no longer a leading /hub/tell link in the feed container to assert here.

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
