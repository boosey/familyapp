// @vitest-environment jsdom
/**
 * AlbumGrid — tiles-as-triggers (#18) + album enhancements (2026-07-13: view selector, size slider,
 * hover mini-toolbar).
 *  1. Each tile is a BUTTON labelled "View …"; tapping a tile opens the photo viewer (role="dialog"),
 *     which HOSTS that photo's full options (delete, caption editor).
 *  2. A captioned tile still shows a small read-only caption for context.
 *  3. NEW: a view selector (Grid / Masonry / List) + a thumbnail-size slider sit above the tiles; each
 *     manageable thumbnail also carries a compact PhotoActionBar mini-toolbar.
 * Mocks next/navigation and the server-action module (a "use server" file that pulls db at import);
 * the real AlbumPhotoViewer mounts when a tile is opened, so those mocks cover it too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AlbumGrid } from "@/app/hub/album/AlbumGrid";
import { hub } from "@/app/_copy";
import type { PendingTile } from "@/app/hub/album/import-progress";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

const editAlbumCaptionAction = vi.fn(
  async (..._args: unknown[]): Promise<{ ok: true }> => ({ ok: true }),
);
const deleteAlbumPhotoAction = vi.fn(
  async (..._args: unknown[]): Promise<{ ok: true }> => ({ ok: true }),
);
const bulkSoftDeleteAlbumPhotosAction = vi.fn(
  async (..._args: unknown[]): Promise<{ deleted: number; failed: number }> => ({
    deleted: 2,
    failed: 0,
  }),
);
// The viewer opened from a tile now hosts PhotoTagPanel, which loads its detail via
// loadPhotoTagPanelAction on mount. Seed a minimal manageable detail so the panel renders without a
// server round-trip; the rest are present so the "use server" module mock is complete.
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
  editAlbumCaptionAction: (...args: unknown[]) => editAlbumCaptionAction(...args),
  deleteAlbumPhotoAction: (...args: unknown[]) => deleteAlbumPhotoAction(...args),
  bulkSoftDeleteAlbumPhotosAction: (...args: unknown[]) =>
    bulkSoftDeleteAlbumPhotosAction(...args),
  loadPhotoTagPanelAction: async (..._args: unknown[]) => PANEL_DATA,
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
const READ_ONLY = { id: "photo-2", caption: "Grandpa at the shore", canManage: false };

describe("AlbumGrid tiles open the photo viewer", () => {
  it("renders each tile as a 'View …' trigger button (image is the trigger)", () => {
    render(<AlbumGrid photos={[MANAGEABLE, READ_ONLY]} />);
    // The tile trigger buttons render in BOTH grid and masonry (default is now Masonry); only the List
    // view swaps to table rows. Each tile's IMAGE trigger uses the "View …" label; the compact toolbar's
    // Edit control does too, so scope to the tile's img.
    expect(screen.getAllByRole("button", { name: /^view photo$/i }).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole("button", { name: /view .*grandpa at the shore/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows no photo viewer dialog until a tile is tapped", () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the photo viewer when a tile is tapped, exposing that photo's options", () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    // The IMAGE trigger is the first "View photo" button (the toolbar's Edit shares the label).
    fireEvent.click(screen.getAllByRole("button", { name: /^view photo$/i })[0]!);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    // The viewer hosts this photo's caption field + a delete control.
    expect(within(dialog).getByRole("textbox", { name: hub.album.captionLabel })).toBeTruthy();
    expect(within(dialog).getAllByRole("button", { name: /^delete$/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("still shows a read-only caption under a captioned tile for context", () => {
    render(<AlbumGrid photos={[READ_ONLY]} />);
    expect(screen.getByText("Grandpa at the shore")).toBeTruthy();
  });
});

describe("AlbumGrid hover mini-toolbar (item 2)", () => {
  it("renders a compact PhotoActionBar with a Delete action for a manageable tile", () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    // The compact toolbar is in the DOM (revealed via CSS on hover/focus) — its Delete is present.
    const group = screen.getByRole("group", { name: hub.album.photoActionsAria(null) });
    expect(within(group).getByRole("button", { name: /^delete$/i })).toBeTruthy();
    // …and Ask / Tell deep-links.
    expect(within(group).getByRole("button", { name: hub.album.askAboutPhoto })).toBeTruthy();
  });

  it("does NOT render a manage-only toolbar Delete for a read-only tile", () => {
    render(<AlbumGrid photos={[READ_ONLY]} />);
    const group = screen.getByRole("group", { name: hub.album.photoActionsAria("Grandpa at the shore") });
    expect(within(group).queryByRole("button", { name: /^delete$/i })).toBeNull();
  });

  it("runs deleteAlbumPhotoAction + refresh on the confirmed (second) delete tap", async () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    const group = screen.getByRole("group", { name: hub.album.photoActionsAria(null) });
    const del = within(group).getByRole("button", { name: /^delete$/i });
    fireEvent.click(del); // arm
    fireEvent.click(within(group).getByRole("button", { name: /tap again to remove/i })); // confirm
    // deleteAlbumPhotoAction is called with a FormData carrying photoId.
    expect(deleteAlbumPhotoAction).toHaveBeenCalledTimes(1);
    const fd = deleteAlbumPhotoAction.mock.calls[0]![0] as FormData;
    expect(fd.get("photoId")).toBe("photo-1");
    // The router refresh happens after the action resolves.
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("AlbumGrid view selector + size slider (items 7 + 8)", () => {
  it("renders the view selector radiogroup with Grid / Masonry / List", () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    const group = screen.getByRole("radiogroup", { name: hub.album.viewSelectorAria });
    expect(within(group).getByRole("radio", { name: hub.album.viewGrid })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: hub.album.viewMasonry })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: hub.album.viewList })).toBeTruthy();
  });

  it("renders the thumbnail-size slider with its aria-label", () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    const slider = screen.getByRole("slider", { name: hub.album.thumbnailSizeLabel });
    expect(slider).toBeTruthy();
    expect((slider as HTMLInputElement).type).toBe("range");
  });

  it("switching to List renders a table with the five column headers", () => {
    render(<AlbumGrid photos={[MANAGEABLE, READ_ONLY]} />);
    fireEvent.click(screen.getByRole("radio", { name: hub.album.viewList }));
    const table = screen.getByRole("table");
    expect(table).toBeTruthy();
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
    const { container } = render(<AlbumGrid photos={[MANAGEABLE]} />);
    // Default is now Masonry.
    expect(container.querySelector('ul[data-view="masonry"]')).toBeTruthy();
    expect(container.querySelector('ul[data-view="grid"]')).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: hub.album.viewGrid }));
    expect(container.querySelector('ul[data-view="grid"]')).toBeTruthy();
    expect(container.querySelector('ul[data-view="masonry"]')).toBeNull();
  });

  it("defaults to Masonry for a fresh viewer with no stored preference", () => {
    const { container } = render(<AlbumGrid photos={[MANAGEABLE]} />);
    expect(
      screen.getByRole("radio", { name: hub.album.viewMasonry }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.querySelector('ul[data-view="masonry"]')).toBeTruthy();
  });

  it("a stored album:view of 'grid' still wins over the Masonry default", () => {
    window.localStorage.setItem("album:view", "grid");
    const { container } = render(<AlbumGrid photos={[MANAGEABLE]} />);
    expect(
      screen.getByRole("radio", { name: hub.album.viewGrid }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(container.querySelector('ul[data-view="grid"]')).toBeTruthy();
  });

  it("renders the passed familyChips inside the consolidated filter/control row", () => {
    render(
      <AlbumGrid
        photos={[MANAGEABLE]}
        familyChips={<div data-testid="fam-chips">chips</div>}
      />,
    );
    const group = screen.getByRole("group", { name: hub.album.filterBarAria });
    expect(within(group).getByTestId("fam-chips")).toBeTruthy();
  });

  it("persists the chosen view to localStorage and restores it on remount", () => {
    const { unmount } = render(<AlbumGrid photos={[MANAGEABLE]} />);
    fireEvent.click(screen.getByRole("radio", { name: hub.album.viewList }));
    expect(window.localStorage.getItem("album:view")).toBe("list");
    unmount();
    cleanup();
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    // Restored: List is checked and a table renders.
    expect(screen.getByRole("radio", { name: hub.album.viewList }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("table")).toBeTruthy();
  });
});

describe("AlbumGrid pending import tiles (ADR-0015 · F2)", () => {
  it("renders N importing placeholder tiles BEFORE the real photos", () => {
    const pending: PendingTile[] = [
      { tempId: "t-1", status: "importing" },
      { tempId: "t-2", status: "importing" },
    ];
    render(<AlbumGrid photos={[MANAGEABLE]} pendingTiles={pending} />);

    const importing = screen.getAllByLabelText(hub.album.importingTile);
    expect(importing).toHaveLength(2);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByLabelText(hub.album.importingTile)).toBeTruthy();
    expect(within(items[1]!).getByLabelText(hub.album.importingTile)).toBeTruthy();
    expect(
      within(items[2]!).getAllByRole("button", { name: /^view photo$/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("a failed tile shows a retry button that calls onRetryTile with its tempId", () => {
    const onRetryTile = vi.fn();
    const pending: PendingTile[] = [{ tempId: "t-fail", status: "failed" }];
    render(<AlbumGrid photos={[]} pendingTiles={pending} onRetryTile={onRetryTile} />);
    const retry = screen.getByRole("button", { name: hub.album.retryImportTile });
    fireEvent.click(retry);
    expect(onRetryTile).toHaveBeenCalledTimes(1);
    expect(onRetryTile).toHaveBeenCalledWith("t-fail");
  });

  it("renders no placeholder tiles when pendingTiles is omitted (flag-off callers unaffected)", () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    expect(screen.queryByLabelText(hub.album.importingTile)).toBeNull();
    expect(screen.queryByRole("button", { name: hub.album.retryImportTile })).toBeNull();
  });
});

// ---- Phase C: enriched fixtures for filter + selection + List columns --------------------------
const THIS_YEAR = new Date().getFullYear();
// Three enriched photos: distinct people, places, capture years, captions.
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

/** Count the rendered photo tiles by their "View …" trigger buttons (Grid view, image trigger). */
function renderedPhotoIds(): string[] {
  // Each tile's image trigger + toolbar Edit share the "View …" label; scope to alt text is simpler.
  return screen
    .queryAllByRole("img")
    .map((img) => (img as HTMLImageElement).getAttribute("src") ?? "")
    .filter((src) => src.startsWith("/api/album-photo/"))
    .map((src) => src.replace("/api/album-photo/", ""));
}

describe("AlbumGrid filtering (item 9)", () => {
  it("filtering by a person narrows the rendered set; clearing restores", () => {
    render(<AlbumGrid photos={ENRICHED} />);
    expect(renderedPhotoIds().sort()).toEqual(["ada", "babbage", "old"]);

    // Toggle the Ada chip in the People filter — only photos with Ada (subject OR appears-in) remain.
    const people = screen.getByRole("group", { name: hub.album.filterPeopleLabel });
    fireEvent.click(within(people).getByRole("button", { name: "Ada", pressed: false }));
    expect(renderedPhotoIds().sort()).toEqual(["ada", "babbage"]);

    // Clear restores all three.
    fireEvent.click(screen.getByRole("button", { name: hub.album.filterClear }));
    expect(renderedPhotoIds().sort()).toEqual(["ada", "babbage", "old"]);
  });

  it("filtering by a place narrows to photos in that place", () => {
    render(<AlbumGrid photos={ENRICHED} />);
    const places = screen.getByRole("group", { name: hub.album.filterPlacesLabel });
    fireEvent.click(within(places).getByRole("button", { name: "Paris" }));
    expect(renderedPhotoIds().sort()).toEqual(["babbage"]);
  });

  it("filtering by period (This year) narrows to this-year captures", () => {
    render(<AlbumGrid photos={ENRICHED} />);
    const period = screen.getByRole("combobox", { name: hub.album.filterPeriodLabel });
    fireEvent.change(period, { target: { value: "thisYear" } });
    expect(renderedPhotoIds().sort()).toEqual(["ada"]);
  });

  it("filtering by caption text narrows to matching captions/tags (case-insensitive)", () => {
    render(<AlbumGrid photos={ENRICHED} />);
    const text = screen.getByRole("searchbox", { name: hub.album.filterTextLabel });
    fireEvent.change(text, { target: { value: "engine" } });
    expect(renderedPhotoIds().sort()).toEqual(["babbage"]);
  });

  it("shows a no-matches note when the filter excludes every photo", () => {
    render(<AlbumGrid photos={ENRICHED} />);
    const text = screen.getByRole("searchbox", { name: hub.album.filterTextLabel });
    fireEvent.change(text, { target: { value: "zzzznomatch" } });
    expect(screen.getByText(hub.album.filterNoMatches)).toBeTruthy();
    expect(renderedPhotoIds()).toEqual([]);
  });
});

describe("AlbumGrid multi-select + bulk actions (item 6)", () => {
  function enterSelectionAndPickTwo() {
    fireEvent.click(screen.getByRole("button", { name: hub.album.selectMode }));
    const checks = screen.getAllByRole("checkbox");
    // Pick the first two tiles.
    fireEvent.click(checks[0]!);
    fireEvent.click(checks[1]!);
  }

  it("entering selection mode shows a checkbox per tile", () => {
    render(<AlbumGrid photos={ENRICHED} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: hub.album.selectMode }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("selecting 2 + Ask pushes the ask multi-URL with both subjectPhotoIds", () => {
    render(<AlbumGrid photos={ENRICHED} />);
    enterSelectionAndPickTwo();
    fireEvent.click(screen.getByRole("button", { name: hub.album.bulkAsk }));
    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0]![0] as string;
    expect(url).toContain("/hub?tab=ask&");
    expect(url).toContain("subjectPhotoIds=ada");
    expect(url).toContain("subjectPhotoIds=babbage");
  });

  it("selecting 2 + Tell pushes the tell multi-URL (first = cover)", () => {
    render(<AlbumGrid photos={ENRICHED} />);
    enterSelectionAndPickTwo();
    fireEvent.click(screen.getByRole("button", { name: hub.album.bulkTell }));
    const url = push.mock.calls[0]![0] as string;
    expect(url).toContain("/hub/tell?");
    expect(url).toContain("subjectPhotoIds=ada");
    expect(url).toContain("subjectPhotoIds=babbage");
  });

  it("Delete selected (two-tap) calls bulkSoftDeleteAlbumPhotosAction with the ids then refreshes", async () => {
    render(<AlbumGrid photos={ENRICHED} />);
    enterSelectionAndPickTwo();
    const del = screen.getByRole("button", { name: hub.album.bulkDelete });
    fireEvent.click(del); // arm
    fireEvent.click(screen.getByRole("button", { name: hub.album.bulkDeleteConfirm })); // confirm
    expect(bulkSoftDeleteAlbumPhotosAction).toHaveBeenCalledTimes(1);
    const fd = bulkSoftDeleteAlbumPhotosAction.mock.calls[0]![0] as FormData;
    expect(fd.getAll("photoIds").sort()).toEqual(["ada", "babbage"]);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("suppresses the per-tile hover toolbar while in selection mode", () => {
    render(<AlbumGrid photos={ENRICHED} />);
    // The compact PhotoActionBar group is present out of selection mode…
    expect(
      screen.getAllByRole("group", { name: /Actions for/ }).length,
    ).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: hub.album.selectMode }));
    // …and gone once selecting.
    expect(screen.queryAllByRole("group", { name: /Actions for/ })).toHaveLength(0);
  });
});

describe("AlbumGrid long-press + Esc entry (item 3)", () => {
  it("long-pressing a tile enters selection mode with that photo pre-picked", () => {
    vi.useFakeTimers();
    try {
      render(<AlbumGrid photos={ENRICHED} />);
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

      const tile = screen.getByRole("button", { name: hub.album.viewPhoto("Ada at the lab") });
      fireEvent.pointerDown(tile);
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Now in selection mode: a checkbox per tile, and Ada's is already checked.
      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
      const adaCheck = screen.getByRole("checkbox", {
        name: hub.album.selectPhotoAria("Ada at the lab"),
      }) as HTMLInputElement;
      expect(adaCheck.checked).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a press released before the threshold does NOT enter selection mode", () => {
    vi.useFakeTimers();
    try {
      render(<AlbumGrid photos={ENRICHED} />);
      const tile = screen.getByRole("button", { name: hub.album.viewPhoto("Ada at the lab") });
      fireEvent.pointerDown(tile);
      fireEvent.pointerUp(tile); // released early — timer cancelled
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Escape cancels selection mode", () => {
    render(<AlbumGrid photos={ENRICHED} />);
    fireEvent.click(screen.getByRole("button", { name: hub.album.selectMode }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});

describe("AlbumListView columns (item 7)", () => {
  it("shows real uploader / families / tags for an enriched photo", () => {
    render(<AlbumGrid photos={[BABBAGE]} />);
    fireEvent.click(screen.getByRole("radio", { name: hub.album.viewList }));
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // Header + one body row.
    const body = rows[1]!;
    const cells = within(body).getAllByRole("cell");
    // Photo, Caption, Added by, Families, Tags, Actions.
    expect(within(body).getByText("Charles by the engine")).toBeTruthy();
    expect(within(body).getByText("Grace")).toBeTruthy(); // uploader
    expect(within(body).getByText("The Lovelaces")).toBeTruthy(); // families
    // Tags = subjects ∪ people ∪ places, comma-joined.
    expect(within(body).getByText(/Charles, Ada, Paris/)).toBeTruthy();
    expect(cells.length).toBeGreaterThanOrEqual(5);
  });

  it("shows a selection checkbox column in the List view when selecting", () => {
    render(<AlbumGrid photos={[BABBAGE]} />);
    fireEvent.click(screen.getByRole("radio", { name: hub.album.viewList }));
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: hub.album.selectMode }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  // Cold-review regression (Phase C): the List row's live action toolbar must ALSO be suppressed in
  // selection mode (as the grid tile is), so a tap meant to select can't fire Delete/Ask/Tell.
  it("suppresses the per-row action toolbar in the List view while selecting", () => {
    render(<AlbumGrid photos={[BABBAGE]} />);
    fireEvent.click(screen.getByRole("radio", { name: hub.album.viewList }));
    expect(
      screen.getAllByRole("group", { name: /Actions for/ }).length,
    ).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: hub.album.selectMode }));
    expect(screen.queryAllByRole("group", { name: /Actions for/ })).toHaveLength(0);
  });
});
