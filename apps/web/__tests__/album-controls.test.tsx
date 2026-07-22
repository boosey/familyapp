// @vitest-environment jsdom
/**
 * AlbumControls (#302) — progressive hub control row wiring + filter/view behavior.
 * Precedence lives in resolveHubControlExpansion; these assert Album occupancy (Search + Filters
 * separate, no Sub tabs), single-row chrome, badges, and that filter/view state still drives the grid.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AlbumControls } from "@/app/hub/album/AlbumControls";
import { HubProgressiveControlRow } from "@/app/hub/HubProgressiveControlRow";
import { IconSheet } from "@/app/hub/IconSheet";
import { hub } from "@/app/_copy";
import { ListFilter, Search } from "lucide-react";
import toolbarStyles from "@/app/hub/HubToolbar.module.css";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

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

/** Widths that collapse Views then Filters while Search stays expanded (Album precedence). */
const COLLAPSE_FILTERS_BEFORE_SEARCH = {
  family: { expanded: 200, collapsedIcon: 48 },
  search: { expanded: 200, collapsedIcon: 48 },
  filters: { expanded: 280, collapsedIcon: 48 },
  views: { expanded: 220, collapsedIcon: 48 },
  actionLabeled: 120,
  actionIconified: 48,
};

function renderedPhotoIds(): string[] {
  return screen
    .queryAllByRole("img")
    .map((img) => (img as HTMLImageElement).getAttribute("src") ?? "")
    .filter((src) => src.startsWith("/api/album-photo/"))
    .map((src) => src.replace("/api/album-photo/", "").replace(/\?.*$/, ""));
}

describe("AlbumControls view selector + size slider", () => {
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
    render(
      <AlbumControls
        photos={[MANAGEABLE, { id: "photo-2", caption: "Grandpa at the shore", canManage: false }]}
        emptyNote="(empty)"
      />,
    );
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

describe("AlbumControls filtering", () => {
  it("filtering by a person narrows the rendered set; clearing restores", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    expect(renderedPhotoIds().sort()).toEqual(["ada", "babbage", "old"]);

    const people = screen.getByRole("group", { name: hub.album.filterPeopleLabel });
    fireEvent.click(within(people).getByRole("button", { name: "Ada", pressed: false }));
    expect(renderedPhotoIds().sort()).toEqual(["ada", "babbage"]);

    fireEvent.click(screen.getByRole("button", { name: hub.album.filterClear }));
    expect(renderedPhotoIds().sort()).toEqual(["ada", "babbage", "old"]);
  });

  it("Filters Clear leaves Search text intact (separate units)", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    fireEvent.change(screen.getByRole("searchbox", { name: hub.album.filterTextLabel }), {
      target: { value: "engine" },
    });
    const people = screen.getByRole("group", { name: hub.album.filterPeopleLabel });
    fireEvent.click(within(people).getByRole("button", { name: "Ada", pressed: false }));
    // Facets Clear must not wipe caption search — Search and Filters are separate units (#302).
    const clearButtons = screen.getAllByRole("button", { name: hub.album.filterClear });
    // Prefer the Filters Clear (facets active); clicking either Search Clear would only clear text.
    fireEvent.click(clearButtons[clearButtons.length - 1]!);
    expect(
      (screen.getByRole("searchbox", { name: hub.album.filterTextLabel }) as HTMLInputElement).value,
    ).toBe("engine");
    expect(renderedPhotoIds().sort()).toEqual(["babbage"]);
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

describe("AlbumControls progressive control row (#302)", () => {
  it("renders a single progressive control row (not HubToolbar two-row chrome)", () => {
    render(
      <AlbumControls
        photos={ENRICHED}
        familyChips={<div data-testid="fam-chips">chips</div>}
        addSlot={<button type="button">{hub.album.addPhotosMenu}</button>}
        emptyNote="(empty)"
      />,
    );
    expect(document.querySelectorAll("[data-hub-progressive-control-row]")).toHaveLength(1);
    expect(document.querySelector(`.${toolbarStyles.toolbar}`)).toBeNull();
    expect(screen.getByRole("combobox", { name: hub.album.filterPeriodLabel })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: hub.album.filterTextLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.album.addPhotosMenu })).toBeTruthy();
    // Family chips also mount in the aria-hidden measure strip — assert at least the visible copy.
    expect(screen.getAllByTestId("fam-chips").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("radiogroup", { name: hub.album.viewSelectorAria })).toBeTruthy();
  });

  it("has no Sub tabs unit; Search and Filters are separate collapse units", () => {
    render(
      <AlbumControls
        photos={ENRICHED}
        forceAvailableWidth={320}
        forceWidths={COLLAPSE_FILTERS_BEFORE_SEARCH}
        emptyNote="(empty)"
      />,
    );
    const row = document.querySelector("[data-hub-progressive-control-row]");
    expect(row?.getAttribute("data-sub-tabs")).toBe("none");
    expect(row?.getAttribute("data-search")).toBe("expanded");
    expect(row?.getAttribute("data-filters")).toBe("collapsed-icon");
    expect(row?.getAttribute("data-views")).toBe("collapsed-icon");
    expect(screen.getByRole("button", { name: hub.mobileControls.filterLabel })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: hub.album.filterTextLabel })).toBeTruthy();
    expect(screen.queryByRole("button", { name: hub.mobileControls.subTabsLabel })).toBeNull();
  });

  it("exposes separate collapsed Search and Filters icons when both must collapse", () => {
    render(
      <HubProgressiveControlRow
        forceAvailableWidth={100}
        forceWidths={{
          search: { expanded: 200, collapsedIcon: 48 },
          filters: { expanded: 280, collapsedIcon: 48 },
        }}
        search={{
          expanded: <input type="search" aria-label={hub.album.filterTextLabel} />,
          collapsed: (
            <IconSheet
              icon={Search}
              label={hub.mobileControls.searchLabel}
              sheetTitle={hub.mobileControls.searchLabel}
            >
              <input type="search" aria-label={hub.album.filterTextLabel} />
            </IconSheet>
          ),
        }}
        filters={{
          expanded: <span>facets</span>,
          collapsed: (
            <IconSheet
              icon={ListFilter}
              label={hub.mobileControls.filterLabel}
              sheetTitle={hub.mobileControls.filterLabel}
            >
              <span>facets</span>
            </IconSheet>
          ),
        }}
      />,
    );
    const row = document.querySelector("[data-hub-progressive-control-row]");
    expect(row?.getAttribute("data-search")).toBe("collapsed-icon");
    expect(row?.getAttribute("data-filters")).toBe("collapsed-icon");
    expect(screen.getByRole("button", { name: hub.mobileControls.searchLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.mobileControls.filterLabel })).toBeTruthy();
  });

  it("keeps Add Photos outside collapse as the trailing action", () => {
    render(
      <AlbumControls
        photos={ENRICHED}
        addSlot={<button type="button">{hub.album.addPhotosMenu}</button>}
        emptyNote="(empty)"
      />,
    );
    expect(screen.getByRole("button", { name: hub.album.addPhotosMenu })).toBeTruthy();
    expect(
      document.querySelector("[data-hub-progressive-control-row]")?.getAttribute("data-action"),
    ).toBe("labeled");
  });

  it("omits Family when no chips are passed", () => {
    render(<AlbumControls photos={ENRICHED} emptyNote="(empty)" />);
    const row = document.querySelector("[data-hub-progressive-control-row]");
    expect(row?.getAttribute("data-family")).toBe("none");
    expect(screen.queryByRole("button", { name: hub.mobileControls.familyLabel })).toBeNull();
  });

  it("badges collapsed Search for text and Filters for facets separately; never badges Views", () => {
    render(
      <AlbumControls
        photos={ENRICHED}
        forceAvailableWidth={100}
        forceWidths={{
          search: { expanded: 200, collapsedIcon: 48 },
          filters: { expanded: 280, collapsedIcon: 48 },
          views: { expanded: 220, collapsedIcon: 48 },
        }}
        emptyNote="(empty)"
      />,
    );
    const badgePhrase = hub.mobileControls.activeCountAria(1);

    // Idle: neither Search nor Filters badged; Views present but unbadged.
    expect(
      screen.getByRole("button", { name: hub.mobileControls.searchLabel }).getAttribute("aria-label"),
    ).toBe(hub.mobileControls.searchLabel);
    expect(
      screen.getByRole("button", { name: hub.mobileControls.filterLabel }).getAttribute("aria-label"),
    ).toBe(hub.mobileControls.filterLabel);
    expect(screen.getByRole("button", { name: hub.mobileControls.viewLabel }).getAttribute("aria-label")).toBe(
      hub.mobileControls.viewLabel,
    );

    // Text search → Search badge only.
    fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.searchLabel }));
    fireEvent.change(screen.getByRole("searchbox", { name: hub.album.filterTextLabel }), {
      target: { value: "wedding" },
    });
    expect(
      screen.getByRole("button", { name: new RegExp(hub.mobileControls.searchLabel) }).getAttribute(
        "aria-label",
      ),
    ).toContain(badgePhrase);
    expect(
      screen.getByRole("button", { name: hub.mobileControls.filterLabel }).getAttribute("aria-label"),
    ).toBe(hub.mobileControls.filterLabel);

    // Clear text, engage a facet → Filters badge only.
    fireEvent.change(screen.getByRole("searchbox", { name: hub.album.filterTextLabel }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.filterLabel }));
    const period = screen.getByRole("combobox", { name: hub.album.filterPeriodLabel });
    fireEvent.change(period, { target: { value: "thisYear" } });
    expect(
      screen.getByRole("button", { name: hub.mobileControls.searchLabel }).getAttribute("aria-label"),
    ).toBe(hub.mobileControls.searchLabel);
    expect(
      screen.getByRole("button", { name: new RegExp(hub.mobileControls.filterLabel) }).getAttribute(
        "aria-label",
      ),
    ).toContain(badgePhrase);
  });

  it("badges collapsed Family when familyFilterActive", () => {
    const badgePhrase = hub.mobileControls.activeCountAria(1);
    const { rerender } = render(
      <AlbumControls
        photos={ENRICHED}
        familyChips={<div data-testid="fam-chips">chips</div>}
        familyFilterActive
        forceAvailableWidth={100}
        forceWidths={{ family: { expanded: 200, collapsedIcon: 48 } }}
        emptyNote="(empty)"
      />,
    );
    expect(
      screen.getByRole("button", { name: new RegExp(hub.mobileControls.familyLabel) }).getAttribute(
        "aria-label",
      ),
    ).toContain(badgePhrase);
    rerender(
      <AlbumControls
        photos={ENRICHED}
        familyChips={<div data-testid="fam-chips">chips</div>}
        familyFilterActive={false}
        forceAvailableWidth={100}
        forceWidths={{ family: { expanded: 200, collapsedIcon: 48 } }}
        emptyNote="(empty)"
      />,
    );
    expect(
      screen.getByRole("button", { name: hub.mobileControls.familyLabel }).getAttribute("aria-label"),
    ).toBe(hub.mobileControls.familyLabel);
  });

  it("opens collapsed Family / Filters panels via IconSheet (sheet/popover shells)", () => {
    render(
      <AlbumControls
        photos={ENRICHED}
        familyChips={<div data-testid="fam-chips">chips</div>}
        forceAvailableWidth={100}
        forceWidths={{
          family: { expanded: 200, collapsedIcon: 48 },
          filters: { expanded: 280, collapsedIcon: 48 },
        }}
        emptyNote="(empty)"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.familyLabel }));
    expect(
      within(screen.getByRole("dialog", { name: hub.mobileControls.familyLabel })).getByTestId(
        "fam-chips",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: hub.mobileControls.filterLabel }));
    expect(
      within(screen.getByRole("dialog", { name: hub.mobileControls.filterLabel })).getByRole(
        "combobox",
        { name: hub.album.filterPeriodLabel },
      ),
    ).toBeTruthy();
  });
});

describe("AlbumControls empty album", () => {
  it("shows Family + Add Photos above the empty note — no Search/Filters/Views, no grid", () => {
    render(
      <AlbumControls
        photos={[]}
        familyChips={<div data-testid="fam-chips">chips</div>}
        addSlot={<button type="button">{hub.album.addPhotosMenu}</button>}
        emptyNote="Nothing here yet"
      />,
    );
    expect(document.querySelectorAll("[data-hub-progressive-control-row]")).toHaveLength(1);
    expect(screen.getByRole("button", { name: hub.album.addPhotosMenu })).toBeTruthy();
    expect(screen.getAllByTestId("fam-chips").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: hub.album.viewSelectorAria })).toBeNull();
    expect(screen.queryByRole("combobox", { name: hub.album.filterPeriodLabel })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: hub.album.filterTextLabel })).toBeNull();
  });
});
