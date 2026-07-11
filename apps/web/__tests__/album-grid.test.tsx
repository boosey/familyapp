// @vitest-environment jsdom
/**
 * AlbumGrid — tiles-as-triggers (#18, post-relocation).
 *  1. Each tile is a BUTTON labelled "View …"; the per-photo options no longer live inline in the
 *     grid, so no delete / caption-editor control renders in the grid before a tile is opened.
 *  2. Tapping a manageable tile opens the photo viewer (role="dialog"), which is where that photo's
 *     options (delete, caption editor) now live.
 *  3. A captioned tile still shows a small read-only caption for context.
 * Mocks next/navigation and the server-action module (a "use server" file that pulls db at import);
 * the real AlbumPhotoViewer mounts when a tile is opened, so those mocks cover it too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AlbumGrid } from "@/app/hub/album/AlbumGrid";
import { hub } from "@/app/_copy";
import type { PendingTile } from "@/app/hub/album/import-progress";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
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
});

const MANAGEABLE = { id: "photo-1", caption: null, canManage: true };
const READ_ONLY = { id: "photo-2", caption: "Grandpa at the shore", canManage: false };

describe("AlbumGrid tiles open the photo viewer", () => {
  it("renders each tile as a 'View …' trigger button (image is the trigger)", () => {
    render(<AlbumGrid photos={[MANAGEABLE, READ_ONLY]} />);
    expect(screen.getByRole("button", { name: /^view photo$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /view .*grandpa at the shore/i })).toBeTruthy();
  });

  it("renders NO inline delete / caption-editor controls in the grid (and no dialog until tapped)", () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add a caption/i })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the photo viewer when a tile is tapped, exposing that photo's options", () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    fireEvent.click(screen.getByRole("button", { name: /^view photo$/i }));
    // The dialog is now open and hosts the manageable photo's options.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /add a caption/i })).toBeTruthy();
  });

  it("still shows a read-only caption under a captioned tile for context", () => {
    render(<AlbumGrid photos={[READ_ONLY]} />);
    expect(screen.getByText("Grandpa at the shore")).toBeTruthy();
  });

  // Regression (review finding): opening a DIFFERENT photo while a viewer is mounted must remount a
  // fresh viewer (via `key={openPhoto.id}`) so the armed two-tap delete state can't leak onto the new
  // photo — otherwise one tap would delete the WRONG photo. B's tile is still in the DOM behind the
  // open viewer (only visually obscured), so this path is reachable in practice.
  it("does NOT leak an armed delete-confirm across photos when another tile is opened", () => {
    const A = { id: "reg-a", caption: null, canManage: true };
    const B = { id: "reg-b", caption: "Second photo", canManage: true };
    render(<AlbumGrid photos={[A, B]} />);

    // Open A and arm its delete (first tap → "Tap again to remove").
    fireEvent.click(screen.getByRole("button", { name: /^view photo$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(screen.getByRole("button", { name: /tap again to remove/i })).toBeTruthy();

    // Open B while A's viewer is mounted.
    fireEvent.click(screen.getByRole("button", { name: /view .*second photo/i }));

    // B's viewer is fresh: delete is UNARMED (no inherited confirm state), so a single tap can't delete B.
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /tap again to remove/i })).toBeNull();
  });
});

describe("AlbumGrid pending import tiles (ADR-0015 · F2)", () => {
  it("renders N importing placeholder tiles BEFORE the real photos", () => {
    const pending: PendingTile[] = [
      { tempId: "t-1", status: "importing" },
      { tempId: "t-2", status: "importing" },
    ];
    render(<AlbumGrid photos={[MANAGEABLE]} pendingTiles={pending} />);

    // Two placeholders labelled "Importing…" plus one real "View photo" trigger.
    const importing = screen.getAllByLabelText(hub.album.importingTile);
    expect(importing).toHaveLength(2);
    // The placeholders come first in DOM order: the first two list items are pending, the last is real.
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByLabelText(hub.album.importingTile)).toBeTruthy();
    expect(within(items[1]!).getByLabelText(hub.album.importingTile)).toBeTruthy();
    expect(within(items[2]!).getByRole("button", { name: /^view photo$/i })).toBeTruthy();
  });

  it("a failed tile shows a retry button that calls onRetryTile with its tempId", () => {
    const onRetryTile = vi.fn();
    const pending: PendingTile[] = [{ tempId: "t-fail", status: "failed" }];
    render(
      <AlbumGrid photos={[]} pendingTiles={pending} onRetryTile={onRetryTile} />,
    );
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
