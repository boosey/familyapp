// @vitest-environment jsdom
/**
 * AlbumControls (album controls hoist) — the album's toolbar owner. State that used to live in AlbumGrid
 * (the When/Search/facet FILTER, the Masonry/Grid/List VIEW, and the thumbnail-size SLIDER) was hoisted
 * here so BOTH album paths compose the SAME two-row HubToolbar above a body-only grid. These tests drive
 * those controls THROUGH AlbumControls (the assertions moved wholesale from album-grid.test.tsx) and pin
 * the load-bearing layout invariants:
 *   - the control area is STRICTLY two toolbar rows (People/Places facets ride INLINE in R1, never a 3rd row);
 *   - "Add Photos" (addSlot) sits on the SAME row as the When/Search filters (R1);
 *   - the family chips + size slider + view selector are R2.
 * Mocks next/navigation and the server-action module; the real AlbumFilterBar / AlbumViewControls /
 * HubToolbar / AlbumGrid mount, so this exercises the whole composed toolbar + body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AlbumControls } from "@/app/hub/album/AlbumControls";
import { hub } from "@/app/_copy";
import toolbarStyles from "@/app/hub/HubToolbar.module.css";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

// AlbumGrid (mounted below the toolbar) opens a viewer that loads its detail via the "use server"
// actions module — stub it exactly as album-grid.test.tsx does so the body renders without a round-trip.
const PANEL_DATA = {
  detail: {
    id: "photo-1",
    caption: null,
    canManage: true,
    contributorDisplayName: "Ada",
    families: [{ familyId: "fam-1", familyName: "The Lovelaces" }],
    subjects: [],
    people: [],
    places: [],
  },
  suggestions: { people: [], families: [{ id: "fam-1", name: "The Lovelaces" }], places: [] },
};
vi.mock("@/app/hub/album/actions", () => ({
  editAlbumCaptionAction: vi.fn(async () => ({ ok: true })),
  deleteAlbumPhotoAction: vi.fn(async () => ({ ok: true })),
  bulkSoftDeleteAlbumPhotosAction: vi.fn(async () => ({ deleted: 0, failed: 0 })),
  loadPhotoTagPanelAction: async () => PANEL_DATA,
  tagPhotoSubjectAction: vi.fn(),
  untagPhotoSubjectAction: vi.fn(),
  tagPhotoPersonAction: vi.fn(),
  untagPhotoPersonAction: vi.fn(),
  tagPhotoPlaceAction: vi.fn(),
  untagPhotoPlaceAction: vi.fn(),
  retargetPhotoFamiliesAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

const MANAGEABLE = { id: "photo-1", caption: null, canManage: true };

// Enriched fixtures (distinct people, places, capture years, captions) for the filter tests.
const THIS_YEAR = new Date().getFullYear();
const ADA = {
  id: "ada",
  caption: "Ada at the lab",
  canManage: true,
  contributorName: "Grace",
  families: [{ id: "fam-1", name: "The Lovelaces" }],
  subjects: [{ id: "p-ada", name: "Ada" }],
  people: [],
  places: [{ id: "pl-london", name: "London" }],
  capturedAt: `${THIS_YEAR}-06-01T00:00:00.000Z`,
};
const BABBAGE = {
  id: "babbage",
  caption: "Charles by the engine",
  canManage: true,
  contributorName: "Grace",
  families: [{ id: "fam-1", name: "The Lovelaces" }],
  subjects: [{ id: "p-charles", name: "Charles" }],
  people: [{ id: "p-ada", name: "Ada" }],
  places: [{ id: "pl-paris", name: "Paris" }],
  capturedAt: `${THIS_YEAR - 3}-06-01T00:00:00.000Z`,
};
const OLD = {
  id: "old",
  caption: "A very old portrait",
  canManage: true,
  contributorName: "Grace",
  families: [{ id: "fam-2", name: "The Byrons" }],
  subjects: [],
  people: [],
  places: [{ id: "pl-london", name: "London" }],
  capturedAt: `${THIS_YEAR - 20}-06-01T00:00:00.000Z`,
};
const ENRICHED = [ADA, BABBAGE, OLD];

/** Count the rendered photo tiles by their <img> src (strip the ?variant=thumb query to the bare id). */
function renderedPhotoIds(): string[] {
  return screen
    .queryAllByRole("img")
    .map((img) => (img as HTMLImageElement).getAttribute("src") ?? "")
    .filter((src) => src.startsWith("/api/album-photo/"))
    .map((src) => src.replace("/api/album-photo/", "").replace(/\?.*$/, ""));
}

/** The rendered HubToolbar rows (in order) — the shared toolbarRows(container) pattern (#190). */
function toolbarRows(container: HTMLElement): HTMLElement[] {
  const toolbar = container.querySelector(`.${toolbarStyles.toolbar}`) as HTMLElement | null;
  if (!toolbar) return [];
  return Array.from(toolbar.querySelectorAll(`.${toolbarStyles.row}`)) as HTMLElement[];
}

describe("AlbumControls view selector + size slider (items 7 + 8)", () => {
  it("renders the view selector radiogroup with Grid / Masonry / List", () => {
    render(<AlbumControls photos={[MANAGEABLE]} emptyNote="(empty)" />);
    const group = screen.getByRole("radiogroup", { name: hub.album.viewSelectorAria });
    expect(within(group).getByRole("radio", { name: hub.album.viewGrid })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: hub.album.viewMasonry })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: hub.album.viewList })).toBeTruthy();
  });

  it("renders the thumbnail-size slider with its aria-label", () => {
    render(<AlbumControls photos={[MANAGEABLE]} emptyNote="(empty)" />);
    const slider = screen.getByRole("slider", { name: hub.album.thumbnailSizeLabel });
    expect(slider).toBeTruthy();
    expect((slider as HTMLInputElement).type).toBe("range");
  });

  it("switching to List renders a table with the five column headers", () => {
    render(<AlbumControls photos={[MANAGEABLE, { id: "photo-2", caption: "Grandpa at the shore", canManage: false }]} emptyNote="(empty)" />);
    fireEvent.click(screen.getByRole("radio", { name: hub.album.viewList }));
    const table = screen.getByRole("table");
    for (const col of [
      hub.album.listColPhoto,
      hub.album.listColCaption,
      hub.album.listColUploader,
      hub.album.listColFamilies,
      hub.album.listColTags,
    ]) {
      expect(within(table).getByRole("columnheader", { name: col })).toBeTruthy();
    }
  });

  it("switching to Grid changes the layout container (data-view=grid, no masonry)", () => {
    const { container } = render(<AlbumControls photos={[MANAGEABLE]} emptyNote="(empty)" />);
    // Default is Masonry.
    expect(container.querySelector('ul[data-view="masonry"]')).toBeTruthy();
    expect(container.querySelector('ul[data-view="grid"]')).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: hub.album.viewGrid }));
    expect(container.querySelector('ul[data-view="grid"]')).toBeTruthy();
    expect(container.querySelector('ul[data-view="masonry"]')).toBeNull();
  });

  it("defaults to Masonry for a fresh viewer with no stored preference", () => {
    const { container } = render(<AlbumControls photos={[MANAGEABLE]} emptyNote="(empty)" />);
    expect(
      screen.getByRole("radio", { name: hub.album.viewMasonry }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.querySelector('ul[data-view="masonry"]')).toBeTruthy();
  });

  it("a stored album:view of 'grid' still wins over the Masonry default", () => {
    window.localStorage.setItem("album:view", "grid");
    const { container } = render(<AlbumControls photos={[MANAGEABLE]} emptyNote="(empty)" />);
    expect(
      screen.getByRole("radio", { name: hub.album.viewGrid }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.querySelector('ul[data-view="grid"]')).toBeTruthy();
  });

  it("persists the chosen view to localStorage and restores it on remount", () => {
    const { unmount } = render(<AlbumControls photos={[MANAGEABLE]} emptyNote="(empty)" />);
    fireEvent.click(screen.getByRole("radio", { name: hub.album.viewList }));
    expect(window.localStorage.getItem("album:view")).toBe("list");
    unmount();
    cleanup();
    render(<AlbumControls photos={[MANAGEABLE]} emptyNote="(empty)" />);
    expect(screen.getByRole("radio", { name: hub.album.viewList }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("table")).toBeTruthy();
  });
});

describe("AlbumControls filtering (item 9)", () => {
  it("filtering by a person narrows the rendered set; clearing restores", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    expect(renderedPhotoIds().sort()).toEqual(["ada", "babbage", "old"]);

    const people = screen.getByRole("group", { name: hub.album.filterPeopleLabel });
    fireEvent.click(within(people).getByRole("button", { name: "Ada", pressed: false }));
    expect(renderedPhotoIds().sort()).toEqual(["ada", "babbage"]);

    fireEvent.click(screen.getByRole("button", { name: hub.album.filterClear }));
    expect(renderedPhotoIds().sort()).toEqual(["ada", "babbage", "old"]);
  });

  it("filtering by a place narrows to photos in that place", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    const places = screen.getByRole("group", { name: hub.album.filterPlacesLabel });
    fireEvent.click(within(places).getByRole("button", { name: "Paris" }));
    expect(renderedPhotoIds().sort()).toEqual(["babbage"]);
  });

  it("filtering by period (This year) narrows to this-year captures", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    const period = screen.getByRole("combobox", { name: hub.album.filterPeriodLabel });
    fireEvent.change(period, { target: { value: "thisYear" } });
    expect(renderedPhotoIds().sort()).toEqual(["ada"]);
  });

  it("filtering by caption text narrows to matching captions/tags (case-insensitive)", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    const text = screen.getByRole("searchbox", { name: hub.album.filterTextLabel });
    fireEvent.change(text, { target: { value: "engine" } });
    expect(renderedPhotoIds().sort()).toEqual(["babbage"]);
  });

  it("shows a no-matches note when the filter excludes every photo", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    const text = screen.getByRole("searchbox", { name: hub.album.filterTextLabel });
    fireEvent.change(text, { target: { value: "zzzznomatch" } });
    expect(screen.getByText(hub.album.filterNoMatches)).toBeTruthy();
    expect(renderedPhotoIds()).toEqual([]);
  });

  it("drops the visible When/Search labels but keeps accessible names + in-control hints", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    const period = screen.getByRole("combobox", { name: hub.album.filterPeriodLabel });
    const search = screen.getByRole("searchbox", { name: hub.album.filterTextLabel });
    expect(search.getAttribute("placeholder")).toBe(hub.album.filterTextPlaceholder);
    expect(within(period).getByRole("option", { name: hub.album.filterPeriodAll })).toBeTruthy();
    expect(screen.queryByText(hub.album.filterPeriodLabel)).toBeNull();
    expect(screen.queryByText(hub.album.filterTextLabel)).toBeNull();
  });
});

describe("AlbumControls HubToolbar layout (controls hoist — strictly two rows)", () => {
  it("renders the When/Search filters, the view controls, and (when passed) Add + family chips", () => {
    render(
      <AlbumControls
        photos={ENRICHED}
        familyChips={<div data-testid="fam-chips">chips</div>}
        addSlot={<button type="button">Add Photos</button>}
        emptyNote="(empty)"
      />,
    );
    expect(screen.getByRole("combobox", { name: hub.album.filterPeriodLabel })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: hub.album.filterTextLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Photos" })).toBeTruthy();
    expect(screen.getByTestId("fam-chips")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: hub.album.viewSelectorAria })).toBeTruthy();
    expect(screen.getByRole("slider", { name: hub.album.thumbnailSizeLabel })).toBeTruthy();
  });

  it("renders the passed familyChips inside the consolidated filter/control row", () => {
    render(
      <AlbumControls
        photos={[MANAGEABLE]}
        familyChips={<div data-testid="fam-chips">chips</div>}
        emptyNote="(empty)"
      />,
    );
    const group = screen.getByRole("group", { name: hub.album.filterBarAria });
    expect(within(group).getByTestId("fam-chips")).toBeTruthy();
  });

  it("omits the family chips entirely when none are passed (no reserved R2-left slot)", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    expect(screen.queryByTestId("fam-chips")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: hub.album.viewSelectorAria })).toBeTruthy();
  });

  // The load-bearing invariant: the control area is STRICTLY two rows, and "Add Photos" shares R1 with
  // the When/Search filters (never a third row for the facets).
  it("keeps the control area to two rows with Add Photos on the same row as When/Search", () => {
    const { container } = render(
      <AlbumControls
        photos={ENRICHED}
        familyChips={<div data-testid="fam-chips">chips</div>}
        addSlot={<button type="button">{hub.album.addPhotosMenu}</button>}
        emptyNote="(empty)"
      />,
    );
    const rows = toolbarRows(container);
    expect(rows.length).toBe(2);
    const r1 = rows[0]!;
    // R1 hosts BOTH the When filter and the Add Photos affordance.
    expect(within(r1).getByRole("combobox", { name: hub.album.filterPeriodLabel })).toBeTruthy();
    expect(within(r1).getByRole("button", { name: hub.album.addPhotosMenu })).toBeTruthy();
  });

  // The People/Places facets ride INLINE in R1 (between When and Search), never a separate third row.
  it("renders the People/Places facet chips inline in R1, keeping the control area at two rows", () => {
    const { container } = render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    const rows = toolbarRows(container);
    expect(rows.length).toBe(2);
    const r1 = rows[0]!;
    expect(within(r1).getByRole("group", { name: hub.album.filterPeopleLabel })).toBeTruthy();
    expect(within(r1).getByRole("group", { name: hub.album.filterPlacesLabel })).toBeTruthy();
  });
});

// ADR-0025 Increment 3 Step B: on a phone (< 40rem) the album's single "⚙ Filters & view" gear splits
// into the shared IconSheet strip — [View][Family][Filter] labeled icon-sheets + the iconified
// Add-Photos action. Each icon renders only when it has content; the Family chips are reached by tapping
// the Family icon. These tests force the compact branch by mocking matchMedia (jsdom leaves it undefined
// → desktop otherwise).
describe("AlbumControls mobile IconSheet strip (Increment 3 Step B)", () => {
  const realMatchMedia = window.matchMedia;
  beforeEach(() => {
    // A compact viewport: the query matches, so useIsCompact() → true.
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it("renders the three per-concern View + Family + Filter icon-sheet triggers", () => {
    render(
      <AlbumControls
        photos={ENRICHED}
        familyChips={<div data-testid="fam-chips">chips</div>}
        emptyNote="(empty)"
      />,
    );
    // The compact strip is the three per-concern icon-sheets (the old single ⚙ gear is gone).
    expect(screen.getByRole("button", { name: hub.mobileControls.viewLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.mobileControls.familyLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.mobileControls.filterLabel })).toBeTruthy();
  });

  it("hides the Family icon for a single-family viewer (no familyChips)", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    expect(screen.queryByRole("button", { name: hub.mobileControls.familyLabel })).toBeNull();
    // View + Filter remain (always have content when there's a grid).
    expect(screen.getByRole("button", { name: hub.mobileControls.viewLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.mobileControls.filterLabel })).toBeTruthy();
  });

  it("tapping the Family icon opens a sheet holding the family chips", () => {
    render(
      <AlbumControls
        photos={ENRICHED}
        familyChips={<div data-testid="fam-chips">chips</div>}
        emptyNote="(empty)"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.familyLabel }));
    const dialog = screen.getByRole("dialog", { name: hub.mobileControls.familyLabel });
    expect(within(dialog).getByTestId("fam-chips")).toBeTruthy();
  });

  it("tapping the Filter icon opens a sheet holding the album's search field", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.filterLabel }));
    const dialog = screen.getByRole("dialog", { name: hub.mobileControls.filterLabel });
    expect(within(dialog).getByRole("searchbox", { name: hub.album.filterTextLabel })).toBeTruthy();
  });

  // ── ADR-0025 Increment 4 — per-icon active badges ──────────────────────────────────────────────
  // A badged IconSheet trigger's accessible NAME gains the active-count phrase (e.g. "Filter, 1 filter
  // active"); unbadged it is just the label. So "is it badged?" = its aria-label contains the phrase.
  const badgePhrase = hub.mobileControls.activeCountAria(1);
  const iconByLabel = (label: string) => screen.getByRole("button", { name: new RegExp(label) });

  it("badges the Filter icon when a When/facets/search filter is active, and not otherwise", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    // Idle: no filter badge.
    expect(iconByLabel(hub.mobileControls.filterLabel).getAttribute("aria-label")).not.toContain(
      badgePhrase,
    );
    // Type a caption/tag search inside the Filter sheet → the Filter icon badges.
    fireEvent.click(iconByLabel(hub.mobileControls.filterLabel));
    fireEvent.change(screen.getByRole("searchbox", { name: hub.album.filterTextLabel }), {
      target: { value: "wedding" },
    });
    expect(iconByLabel(hub.mobileControls.filterLabel).getAttribute("aria-label")).toContain(
      badgePhrase,
    );
  });

  it("badges the Family icon when the family filter is a subset (familyFilterActive), not otherwise", () => {
    const { rerender } = render(
      <AlbumControls
        photos={ENRICHED}
        familyChips={<div data-testid="fam-chips">chips</div>}
        familyFilterActive
        emptyNote="(empty)"
      />,
    );
    expect(iconByLabel(hub.mobileControls.familyLabel).getAttribute("aria-label")).toContain(
      badgePhrase,
    );
    rerender(
      <AlbumControls
        photos={ENRICHED}
        familyChips={<div data-testid="fam-chips">chips</div>}
        familyFilterActive={false}
        emptyNote="(empty)"
      />,
    );
    expect(iconByLabel(hub.mobileControls.familyLabel).getAttribute("aria-label")).not.toContain(
      badgePhrase,
    );
  });

  it("never badges the View icon", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    // View is never badged, so its trigger's accessible name is EXACTLY "View" (exact match — a loose
    // /View/ regex would also hit the Grid/Masonry/List controls inside the sheet).
    expect(screen.getByRole("button", { name: hub.mobileControls.viewLabel })).toBeTruthy();
  });
});

describe("AlbumControls empty album", () => {
  it("shows a minimal toolbar (Add Photos + family chips) above the empty note — no grid, no filters", () => {
    render(
      <AlbumControls
        photos={[]}
        familyChips={<div data-testid="fam-chips">chips</div>}
        addSlot={<button type="button">{hub.album.addPhotosMenu}</button>}
        emptyNote="Nothing here yet"
      />,
    );
    // Add Photos + chips still render (the add flow is never hidden by an empty album)…
    expect(screen.getByRole("button", { name: hub.album.addPhotosMenu })).toBeTruthy();
    expect(screen.getByTestId("fam-chips")).toBeTruthy();
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    // …but the filter/view controls (which would steer nothing) and the grid do not.
    expect(screen.queryByRole("radiogroup", { name: hub.album.viewSelectorAria })).toBeNull();
    expect(screen.queryByRole("combobox", { name: hub.album.filterPeriodLabel })).toBeNull();
  });
});
