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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
vi.mock("@/app/hub/album/actions", () => ({
  editAlbumCaptionAction: (...args: unknown[]) => editAlbumCaptionAction(...args),
  deleteAlbumPhotoAction: (...args: unknown[]) => deleteAlbumPhotoAction(...args),
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
    // Two tiles + the List-view thumbnails don't render here (default Grid). Each tile's IMAGE trigger
    // uses the "View …" label; the compact toolbar's Edit control does too, so scope to the tile's img.
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

  it("switching to Masonry changes the layout container (data-view=masonry, no grid)", () => {
    const { container } = render(<AlbumGrid photos={[MANAGEABLE]} />);
    // Default is Grid.
    expect(container.querySelector('ul[data-view="grid"]')).toBeTruthy();
    expect(container.querySelector('ul[data-view="masonry"]')).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: hub.album.viewMasonry }));
    expect(container.querySelector('ul[data-view="masonry"]')).toBeTruthy();
    expect(container.querySelector('ul[data-view="grid"]')).toBeNull();
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
