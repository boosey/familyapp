// @vitest-environment jsdom
/**
 * AlbumGrid — the per-tile management controls (#18).
 *  1. A `canManage: true` tile renders the caption affordance + a delete control; a `canManage: false`
 *     tile renders neither (image + read-only caption only).
 *  2. Delete requires TWO taps: the first arms the confirm, only the second calls the delete action.
 *  3. Editing a caption calls `editAlbumCaptionAction` with the typed value (via FormData).
 * Mocks next/navigation and the server-action module (a "use server" file that pulls db at import).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AlbumGrid } from "@/app/hub/album/AlbumGrid";

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

describe("AlbumGrid management controls", () => {
  it("renders caption + delete controls for a manageable tile", () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    expect(screen.getByRole("button", { name: /add a caption/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeTruthy();
  });

  it("renders NO manage controls for a read-only tile (image + caption only)", () => {
    render(<AlbumGrid photos={[READ_ONLY]} />);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add a caption/i })).toBeNull();
    // The read-only caption still shows, and the image is present.
    expect(screen.getByText("Grandpa at the shore")).toBeTruthy();
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("requires two taps to delete (first arms, second calls the action)", () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    const del = screen.getByRole("button", { name: /^delete$/i });
    fireEvent.click(del);
    // First tap does NOT call the action; the button now shows the confirm label.
    expect(deleteAlbumPhotoAction).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: /tap again to remove/i });
    fireEvent.click(confirm);
    expect(deleteAlbumPhotoAction).toHaveBeenCalledTimes(1);
    const fd = deleteAlbumPhotoAction.mock.calls[0]![0] as FormData;
    expect(fd.get("photoId")).toBe("photo-1");
  });

  it("edits a caption by calling editAlbumCaptionAction with the typed value", () => {
    render(<AlbumGrid photos={[MANAGEABLE]} />);
    fireEvent.click(screen.getByRole("button", { name: /add a caption/i }));
    const input = screen.getByLabelText(/caption/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Nonna, 1962" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(editAlbumCaptionAction).toHaveBeenCalledTimes(1);
    const fd = editAlbumCaptionAction.mock.calls[0]![0] as FormData;
    expect(fd.get("photoId")).toBe("photo-1");
    expect(fd.get("caption")).toBe("Nonna, 1962");
  });
});
