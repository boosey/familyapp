// @vitest-environment jsdom
/**
 * AlbumPhotoViewer — the per-photo viewer that hosts a photo's options (#18, album enhancements
 * item 3).
 *  1. A manageable photo shows an ALWAYS-visible caption ENTRY FIELD (placeholder "Caption") plus the
 *     shared PhotoActionBar (Ask / Tell / Delete etc.); a view-only photo shows the read-only caption
 *     text and NO caption input and NO manage-only buttons — `canManage` gates visibility only.
 *  2. Delete's two-tap confirm now lives in PhotoActionBar: the first tap arms, the second calls
 *     deleteAlbumPhotoAction; on success the viewer closes (onClose) and the server component refreshes.
 *  3. Editing the caption input and blurring calls `editAlbumCaptionAction` with the typed value.
 *  4. Escape and a backdrop click both close the viewer.
 * Mocks next/navigation and the server-action module (a "use server" file that pulls db at import).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AlbumPhotoViewer } from "@/app/hub/album/AlbumPhotoViewer";

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
// The viewer now hosts PhotoTagPanel, which loads its detail via loadPhotoTagPanelAction on mount.
// Seed a manageable detail so the People section (and its input) render for the "Tag people" test.
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
const loadPhotoTagPanelAction = vi.fn(async (..._args: unknown[]) => PANEL_DATA);
vi.mock("@/app/hub/album/actions", () => ({
  editAlbumCaptionAction: (...args: unknown[]) => editAlbumCaptionAction(...args),
  deleteAlbumPhotoAction: (...args: unknown[]) => deleteAlbumPhotoAction(...args),
  loadPhotoTagPanelAction: (...args: unknown[]) => loadPhotoTagPanelAction(...args),
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
});

const MANAGEABLE = { id: "photo-1", caption: null, canManage: true };
const READ_ONLY = { id: "photo-2", caption: "Grandpa at the shore", canManage: false };

describe("AlbumPhotoViewer", () => {
  it("shows the caption entry field (placeholder Caption) + action bar for a manageable photo", () => {
    render(<AlbumPhotoViewer photo={MANAGEABLE} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    // The caption is ALWAYS an <input> now — no "Add a caption" button.
    expect(screen.queryByRole("button", { name: /add a caption/i })).toBeNull();
    const input = screen.getByLabelText(/^caption$/i) as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("placeholder")).toBe("Caption");
    // PhotoActionBar (full) renders Ask / Tell / Delete for a manager, on one action row.
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /tell a story/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeTruthy();
  });

  it("shows read-only caption (no input, no manage buttons) for a view-only photo", () => {
    render(<AlbumPhotoViewer photo={READ_ONLY} onClose={vi.fn()} />);
    // No caption input and no manage-only controls for a non-manager.
    expect(screen.queryByLabelText(/^caption$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    // The caption is shown read-only; the image is present.
    expect(screen.getByText("Grandpa at the shore")).toBeTruthy();
    expect(screen.getByRole("img")).toBeTruthy();
    // A non-manager still gets the Ask/Tell deep-links via the shared action bar.
    expect(screen.getByRole("button", { name: /^ask$/i })).toBeTruthy();
  });

  it("requires two taps to delete (confirm owned by PhotoActionBar), then closes + refreshes", async () => {
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

  it("saves the caption on blur (when changed) by calling editAlbumCaptionAction with the typed value", () => {
    render(<AlbumPhotoViewer photo={MANAGEABLE} onClose={vi.fn()} />);
    const input = screen.getByLabelText(/^caption$/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Nonna, 1962" } });
    fireEvent.blur(input);
    expect(editAlbumCaptionAction).toHaveBeenCalledTimes(1);
    const fd = editAlbumCaptionAction.mock.calls[0]![0] as FormData;
    expect(fd.get("photoId")).toBe("photo-1");
    expect(fd.get("caption")).toBe("Nonna, 1962");
  });

  it("does not save on blur when the caption is unchanged", () => {
    render(<AlbumPhotoViewer photo={MANAGEABLE} onClose={vi.fn()} />);
    const input = screen.getByLabelText(/^caption$/i) as HTMLInputElement;
    fireEvent.blur(input);
    expect(editAlbumCaptionAction).not.toHaveBeenCalled();
  });

  it("focuses the caption input when the action bar's Edit is tapped", () => {
    render(<AlbumPhotoViewer photo={MANAGEABLE} onClose={vi.fn()} />);
    const input = screen.getByLabelText(/^caption$/i) as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(document.activeElement).toBe(input);
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
    // A click that originates on the dialog card does not close (ModalShell stops it bubbling to the
    // overlay)...
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    // ...a click on the ModalShell overlay (the scrim, role="presentation") does.
    fireEvent.click(screen.getByRole("presentation"));
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

  // Phase B3: the viewer hosts the tag-management panel (Subjects / People / Places / Family).
  it("renders the PhotoTagPanel inside the dialog", async () => {
    render(<AlbumPhotoViewer photo={MANAGEABLE} onClose={vi.fn()} />);
    expect(await screen.findByRole("group", { name: /photo details/i })).toBeTruthy();
    expect(loadPhotoTagPanelAction).toHaveBeenCalledWith("photo-1");
  });

  // Phase B3: the now-enabled "Tag people" action bar button scrolls to + focuses the People input.
  it("focuses the People tag input when the action bar's Tag people is tapped", async () => {
    // jsdom has no scrollIntoView — provide a spy so the handler doesn't throw.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<AlbumPhotoViewer photo={MANAGEABLE} onClose={vi.fn()} />);
    // Wait for the panel to load so the People input exists.
    await screen.findByRole("group", { name: /photo details/i });
    const peopleInputs = screen.getAllByPlaceholderText(/add a person/i);
    // People is the SECOND person field (Subjects is first).
    const peopleInput = peopleInputs[1]!;
    expect(document.activeElement).not.toBe(peopleInput);
    fireEvent.click(screen.getByRole("button", { name: /tag people/i }));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(peopleInput);
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
