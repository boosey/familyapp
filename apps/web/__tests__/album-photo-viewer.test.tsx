// @vitest-environment jsdom
/**
 * AlbumPhotoViewer — the per-photo viewer that hosts a photo's options (#18, post-relocation).
 *  1. A manageable photo shows the caption editor + a delete control; a view-only photo shows
 *     neither (image + read-only caption only) — `canManage` gates visibility, nothing more.
 *  2. Delete requires TWO taps: the first arms the confirm, only the second calls the delete action;
 *     on success the viewer closes (onClose) and the server component refreshes.
 *  3. Editing a caption calls `editAlbumCaptionAction` with the typed value (via FormData).
 *  4. Escape and a backdrop click both close the viewer.
 * Mocks next/navigation and the server-action module (a "use server" file that pulls db at import).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AlbumPhotoViewer } from "@/app/hub/album/AlbumPhotoViewer";

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

describe("AlbumPhotoViewer", () => {
  it("shows caption editor + delete for a manageable photo", () => {
    render(<AlbumPhotoViewer photo={MANAGEABLE} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: /add a caption/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeTruthy();
  });

  it("hides caption editor + delete for a view-only photo (image + caption only)", () => {
    render(<AlbumPhotoViewer photo={READ_ONLY} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /add a caption/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    // The caption is shown read-only; the image is present.
    expect(screen.getByText("Grandpa at the shore")).toBeTruthy();
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("requires two taps to delete, then closes + refreshes on success", async () => {
    const onClose = vi.fn();
    render(<AlbumPhotoViewer photo={MANAGEABLE} onClose={onClose} />);
    const del = screen.getByRole("button", { name: /^delete$/i });
    fireEvent.click(del);
    // First tap only arms the confirm — the action is NOT called.
    expect(deleteAlbumPhotoAction).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: /tap again to remove/i });
    fireEvent.click(confirm);
    expect(deleteAlbumPhotoAction).toHaveBeenCalledTimes(1);
    const fd = deleteAlbumPhotoAction.mock.calls[0]![0] as FormData;
    expect(fd.get("photoId")).toBe("photo-1");
    // On success the viewer closes and the server component refreshes.
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalled();
  });

  it("edits a caption by calling editAlbumCaptionAction with the typed value", () => {
    render(<AlbumPhotoViewer photo={MANAGEABLE} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add a caption/i }));
    const input = screen.getByLabelText(/^caption$/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Nonna, 1962" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(editAlbumCaptionAction).toHaveBeenCalledTimes(1);
    const fd = editAlbumCaptionAction.mock.calls[0]![0] as FormData;
    expect(fd.get("photoId")).toBe("photo-1");
    expect(fd.get("caption")).toBe("Nonna, 1962");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<AlbumPhotoViewer photo={READ_ONLY} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click (but not on a click inside the dialog)", () => {
    const onClose = vi.fn();
    render(<AlbumPhotoViewer photo={READ_ONLY} onClose={onClose} />);
    // A click that originates on the dialog card does not close...
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    // ...a click on the backdrop itself does.
    fireEvent.click(screen.getByTestId("album-viewer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Regression (review finding): the dialog must take focus on open and give it back to the trigger
  // on close, so keyboard/AT users aren't dropped at the top of the document.
  it("moves focus into the dialog on open and restores it to the trigger on close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<AlbumPhotoViewer photo={MANAGEABLE} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  // Regression (review finding): Tab is trapped inside the dialog — without the trap, tabbing off the
  // first/last control escapes to the grid tiles behind the modal.
  it("traps Tab within the dialog: forward wraps last→first, Shift+Tab wraps first→last", () => {
    render(<AlbumPhotoViewer photo={MANAGEABLE} onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: /^close$/i });
    const del = screen.getByRole("button", { name: /^delete$/i });

    // Forward Tab from the LAST focusable wraps back to the first (Close).
    del.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    // Shift+Tab from the FIRST focusable wraps to the last (Delete).
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(del);
  });
});
