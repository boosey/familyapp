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

// The view/size CONTROLS now live in AlbumControls (see album-controls.test.tsx). AlbumGrid is the
// body — it renders whatever `view`/`thumbPx` it is handed. These pin the controlled `view` prop → the
// right layout container / table.
describe("AlbumGrid renders the controlled view (body only)", () => {
  it("defaults to Masonry when rendered uncontrolled", () => {
    const { container } = render(<AlbumGrid photos={[MANAGEABLE]} />);
    expect(container.querySelector('ul[data-view="masonry"]')).toBeTruthy();
    expect(container.querySelector('ul[data-view="grid"]')).toBeNull();
  });

  it("renders the CSS grid container for view='grid'", () => {
    const { container } = render(<AlbumGrid photos={[MANAGEABLE]} view="grid" />);
    expect(container.querySelector('ul[data-view="grid"]')).toBeTruthy();
    expect(container.querySelector('ul[data-view="masonry"]')).toBeNull();
  });

  it("renders the List table (with the five column headers) for view='list'", () => {
    render(<AlbumGrid photos={[MANAGEABLE, READ_ONLY]} view="list" />);
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

describe("AlbumGrid multi-select + bulk actions (item 6)", () => {
  // #191 — the standing "Select" toggle is GONE; selection mode is entered by long-pressing a tile.
  // Enter via a long-press on the first tile, then (still in select mode) tick a second checkbox. Fake
  // timers are scoped to JUST the long-press so the surrounding test keeps real timers for its awaits.
  function enterSelectionAndPickTwo() {
    const first = screen.getAllByRole("button", { name: /^view /i })[0]!;
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(first);
      act(() => {
        vi.advanceTimersByTime(500);
      });
    } finally {
      vi.useRealTimers();
    }
    const checks = screen.getAllByRole("checkbox");
    // The long-pressed tile is already checked; add ONE more so exactly two are selected.
    const secondUnchecked = checks.find((c) => !(c as HTMLInputElement).checked)!;
    fireEvent.click(secondUnchecked);
  }

  // #191 — the standing "Select" toggle button no longer exists anywhere in the grid.
  it("does NOT render a standing 'Select' toggle button", () => {
    render(<AlbumGrid photos={ENRICHED} />);
    expect(screen.queryByRole("button", { name: /^select$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^done$/i })).toBeNull();
  });

  it("entering selection mode (long-press) shows a checkbox per tile", () => {
    vi.useFakeTimers();
    try {
      render(<AlbumGrid photos={ENRICHED} />);
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      const first = screen.getAllByRole("button", { name: /^view /i })[0]!;
      fireEvent.pointerDown(first);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
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

  // #191 regression: after a successful bulk delete the grid must LEAVE selection mode (not just empty
  // the selection). With the standing "Select"/"Done" toggle gone and the bulk bar hidden once the
  // selection empties, keeping `selecting` true would strand the viewer with checkboxes and no visible
  // exit. The result note must survive, but the checkboxes must be gone.
  it("leaves selection mode after a successful bulk delete (no stranded checkboxes; note kept)", async () => {
    bulkSoftDeleteAlbumPhotosAction.mockResolvedValueOnce({ deleted: 2, failed: 0 });
    render(<AlbumGrid photos={ENRICHED} />);
    enterSelectionAndPickTwo();
    // In selection mode with a bulk bar present.
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: hub.album.bulkDelete })); // arm
    fireEvent.click(screen.getByRole("button", { name: hub.album.bulkDeleteConfirm })); // confirm
    // Once the action resolves: selection mode is exited (no checkboxes) but the result note remains.
    await vi.waitFor(() => expect(screen.queryAllByRole("checkbox")).toHaveLength(0));
    expect(screen.getByText(hub.album.bulkDeleteResult(2, 0))).toBeTruthy();
  });

  it("suppresses the per-tile hover toolbar while in selection mode", () => {
    vi.useFakeTimers();
    try {
      render(<AlbumGrid photos={ENRICHED} />);
      // The compact PhotoActionBar group for a specific photo is present out of selection mode…
      const adaActions = hub.album.photoActionsAria("Ada at the lab");
      expect(screen.getAllByRole("group", { name: adaActions }).length).toBeGreaterThanOrEqual(1);
      const first = screen.getAllByRole("button", { name: /^view /i })[0]!;
      fireEvent.pointerDown(first);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      // …and gone once selecting (the bulk bar's own "Actions for the selected photos" group is a
      // DIFFERENT label and is expected to appear; we assert only the per-photo toolbars are gone).
      expect(screen.queryAllByRole("group", { name: adaActions })).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
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
    vi.useFakeTimers();
    try {
      render(<AlbumGrid photos={ENRICHED} />);
      const first = screen.getAllByRole("button", { name: /^view /i })[0]!;
      fireEvent.pointerDown(first);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // #191 — with the standing "Select" toggle gone, the bulk bar's Clear is the visible exit from
  // selection mode (it drops the selection AND leaves select mode; the checkboxes disappear).
  it("the bulk bar's Clear leaves selection mode (checkboxes disappear)", () => {
    vi.useFakeTimers();
    try {
      render(<AlbumGrid photos={ENRICHED} />);
      const first = screen.getAllByRole("button", { name: /^view /i })[0]!;
      fireEvent.pointerDown(first);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      // One photo picked ⇒ the bulk bar (with Clear) is present.
      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
      fireEvent.click(screen.getByRole("button", { name: hub.album.bulkClear }));
      // Selection mode exited: no checkboxes remain.
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AlbumListView columns (item 7)", () => {
  it("shows real uploader / families / tags for an enriched photo", () => {
    render(<AlbumGrid photos={[BABBAGE]} view="list" />);
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

  // #191 — long-pressing a List row's thumbnail enters selection mode (the Select toggle is gone).
  it("long-pressing a List row thumbnail enters selection mode with a checkbox column", () => {
    vi.useFakeTimers();
    try {
      render(<AlbumGrid photos={[BABBAGE]} view="list" />);
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      const row = screen.getByRole("button", { name: hub.album.viewPhoto("Charles by the engine") });
      fireEvent.pointerDown(row);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.getAllByRole("checkbox")).toHaveLength(1);
      // The long-pressed row is already picked.
      expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // Cold-review regression (Phase C): the List row's live action toolbar must ALSO be suppressed in
  // selection mode (as the grid tile is), so a tap meant to select can't fire Delete/Ask/Tell.
  it("suppresses the per-row action toolbar in the List view while selecting", () => {
    vi.useFakeTimers();
    try {
      render(<AlbumGrid photos={[BABBAGE]} view="list" />);
      const charlesActions = hub.album.photoActionsAria("Charles by the engine");
      expect(screen.getAllByRole("group", { name: charlesActions }).length).toBeGreaterThanOrEqual(1);
      const row = screen.getByRole("button", { name: hub.album.viewPhoto("Charles by the engine") });
      fireEvent.pointerDown(row);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      // The per-row toolbar is gone; the bulk bar's own group (a different label) may appear.
      expect(screen.queryAllByRole("group", { name: charlesActions })).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
