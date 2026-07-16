// @vitest-environment jsdom
/**
 * AlbumUploader — the files-first destination modal (#94) + the button-opens-picker upload flow,
 * driven through the consolidated "Add Photos ▾" dropdown (#93).
 *  1. In >=2 families: choosing files / completing the Google picker OPENS a destination modal whose
 *     chips pick which family album(s) receive the batch — the standing "Which albums?" fieldset is
 *     gone (#94). The modal's Add is disabled until ≥1 family is chosen (the sole no-fan-out gate).
 *  2. Solo (one family): NO modal — the add/import proceeds straight through with no familyIds (the
 *     server defaults to the sole family).
 *  3. Filter-aware default: `defaultSelected` seeds the modal (single concrete family pre-selected
 *     visibly; ambiguous opens blank so Add stays disabled until a deliberate pick).
 *  4. Cancel/Escape/backdrop discard the pending payload — zero storage writes.
 *  5. #93 — device add / Google connect / Google import / Disconnect all live inside ONE right-
 *     justified "Add Photos" menu; opening the menu is the first step for each.
 * Mocks next/navigation and the server-action module (a "use server" file that pulls db at import).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AlbumUploader } from "@/app/hub/album/AlbumUploader";
import { hub } from "@/app/_copy";

const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace }),
}));

// issue #20 — the uploader's legacy (non-board) path uploads each file directly to storage via
// uploadPhotoDirect(file, familyIds) (request target → PUT → record). Default: success.
let photoSeq = 0;
const uploadPhotoDirect = vi.fn(
  async (
    ..._args: unknown[]
  ): Promise<{ ok: true; photoId: string } | { error: string }> => ({
    ok: true,
    photoId: `photo-${(photoSeq += 1)}`,
  }),
);
vi.mock("@/app/hub/album/direct-upload", () => ({
  uploadPhotoDirect: (...args: unknown[]) => uploadPhotoDirect(...args),
}));

// prepare-photo runs client-side (HEIC/resize/encode) before each direct upload. Default: pass the
// file straight through; individual tests override to force a hard prepare failure mid-batch.
const prepareAlbumPhoto = vi.fn(
  async (file: File): Promise<{ ok: true; file: File } | { ok: false; error: string }> => ({
    ok: true,
    file,
  }),
);
vi.mock("@/app/hub/album/prepare-photo", () => ({
  prepareAlbumPhoto: (file: File) => prepareAlbumPhoto(file),
}));

const startGooglePhotosImportAction = vi.fn();
const pollGooglePhotosImportAction = vi.fn();
const completeGooglePhotosImportAction = vi.fn();
const disconnectGooglePhotosAction = vi.fn();
vi.mock("@/app/hub/album/google-photos-actions", () => ({
  startGooglePhotosImportAction: (...args: unknown[]) => startGooglePhotosImportAction(...args),
  pollGooglePhotosImportAction: (...args: unknown[]) => pollGooglePhotosImportAction(...args),
  completeGooglePhotosImportAction: (...args: unknown[]) =>
    completeGooglePhotosImportAction(...args),
  disconnectGooglePhotosAction: (...args: unknown[]) => disconnectGooglePhotosAction(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FAM_A = { familyId: "aaaaaaaa-0000-0000-0000-000000000000", familyName: "Esposito" };
const FAM_B = { familyId: "bbbbbbbb-0000-0000-0000-000000000000", familyName: "Marino" };

/** The placement is now aria-pressed chips (ADR-0021 · FamilyChoiceChips), not checkboxes: the chip
 *  for a family is a button whose accessible name is the family name; ON = aria-pressed="true". */
const chip = (name: string): HTMLElement => screen.getByRole("button", { name });
const isOn = (name: string): boolean => chip(name).getAttribute("aria-pressed") === "true";

/** #93 — open the single "Add Photos ▾" dropdown so its menuitems become queryable. */
const openAddMenu = (): void => {
  fireEvent.click(screen.getByRole("button", { name: hub.album.addPhotosMenu }));
};
/** The device-add menuitem inside the open Add Photos menu. */
const deviceItem = (): HTMLButtonElement =>
  screen.getByRole("menuitem", { name: hub.album.addFromDevice }) as HTMLButtonElement;

/** #94 — the destination modal (rendered after files/import when >1 family). */
const modal = (): HTMLElement | null => screen.queryByRole("dialog");
/** The modal's Add / Cancel controls. */
const addBtn = (): HTMLButtonElement =>
  screen.getByRole("button", { name: hub.album.destinationAdd }) as HTMLButtonElement;
const cancelBtn = (): HTMLButtonElement =>
  screen.getByRole("button", { name: hub.album.destinationCancel }) as HTMLButtonElement;

/** Choose files via the hidden input — for a >1-family viewer this OPENS the destination modal. */
const chooseFiles = (files: File[]): void => {
  const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files } });
};
const pngFile = (name: string): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

describe("AlbumUploader files-first destination modal (#94)", () => {
  // The standing "Which albums?" fieldset is GONE — a >1-family viewer sees NO chips until they choose
  // files / import (the modal). Nothing is pre-rendered on the toolbar.
  it("shows NO standing destination chips for a >1-family viewer", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_B.familyId} />,
    );
    expect(modal()).toBeNull();
    expect(screen.queryByRole("button", { name: FAM_A.familyName })).toBeNull();
    expect(screen.queryByRole("button", { name: FAM_B.familyName })).toBeNull();
  });

  // Choosing files opens the destination modal; its title is count-aware; the seed follows the current
  // context (default = the album on screen). The upload does NOT fire until Add.
  it("opens the count-aware modal on file choice, seeded to the current family, without uploading", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_B.familyId} />,
    );
    chooseFiles([pngFile("p1.png"), pngFile("p2.png")]);
    expect(modal()).not.toBeNull();
    // Count-aware title (2 photos).
    expect(screen.getByText(hub.album.destinationTitle(2))).toBeTruthy();
    // Seed = the current-context family (FAM_B), visibly.
    expect(isOn(FAM_B.familyName)).toBe(true);
    expect(isOn(FAM_A.familyName)).toBe(false);
    // Nothing stored yet — the upload fires on Add.
    expect(uploadPhotoDirect).not.toHaveBeenCalled();
  });

  it("renders NO modal for a solo-family contributor (proceeds directly)", () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    // No chips ever, and choosing a file does not open a dialog.
    expect(screen.queryByRole("button", { name: FAM_A.familyName })).toBeNull();
    chooseFiles([pngFile("solo.png")]);
    expect(modal()).toBeNull();
  });

  // REQUIRED regression (1) — no-fan-out gate: multi-family + ambiguous filter → the modal's Add is
  // disabled until a deliberate pick, and it can never complete an add on an empty selection.
  it("multi-family + ambiguous filter: modal Add disabled until a pick", () => {
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[]}
      />,
    );
    chooseFiles([pngFile("p1.png")]);
    // Blank selection ⇒ Add disabled.
    expect(isOn(FAM_A.familyName)).toBe(false);
    expect(isOn(FAM_B.familyName)).toBe(false);
    expect(addBtn().disabled).toBe(true);
    // A deliberate pick enables it, and Add uploads to ONLY that family.
    fireEvent.click(chip(FAM_A.familyName));
    expect(addBtn().disabled).toBe(false);
  });

  // REQUIRED regression (2) — filter-aware default: a single concrete family filter pre-selects that
  // family VISIBLY in the modal; an ambiguous filter opens blank.
  it("filter-aware default: concrete filter pre-selects (visibly); ambiguous opens blank", () => {
    const { rerender } = render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[FAM_B.familyId]}
      />,
    );
    chooseFiles([pngFile("p.png")]);
    expect(isOn(FAM_B.familyName)).toBe(true);
    expect(isOn(FAM_A.familyName)).toBe(false);
    expect(addBtn().disabled).toBe(false);
    fireEvent.click(cancelBtn());

    // Ambiguous filter (empty default) opens the modal blank.
    rerender(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[]}
      />,
    );
    chooseFiles([pngFile("p.png")]);
    expect(isOn(FAM_A.familyName)).toBe(false);
    expect(isOn(FAM_B.familyName)).toBe(false);
    expect(addBtn().disabled).toBe(true);
  });

  // REQUIRED regression (3) — solo-family no-modal: upload proceeds directly, no dialog in DOM, and NO
  // familyIds sent (the server defaults to the sole family).
  it("solo-family: upload proceeds directly with no modal and no familyIds", async () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    chooseFiles([pngFile("solo.png")]);
    expect(modal()).toBeNull();
    await vi.waitFor(() => expect(uploadPhotoDirect).toHaveBeenCalledTimes(1));
    expect(uploadPhotoDirect.mock.calls[0]![1]).toEqual([]);
  });

  // REQUIRED regression (4) — Cancel writes nothing: the pending payload is discarded, the modal
  // closes, and uploadPhotoDirect is never called.
  it("Cancel discards the pending payload — zero storage writes", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    chooseFiles([pngFile("p1.png")]);
    expect(modal()).not.toBeNull();
    fireEvent.click(cancelBtn());
    expect(modal()).toBeNull();
    expect(uploadPhotoDirect).not.toHaveBeenCalled();
  });

  // Escape also cancels (dialog contract) with no storage write.
  it("Escape cancels the modal (no upload)", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    chooseFiles([pngFile("p1.png")]);
    expect(modal()).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(modal()).toBeNull();
    expect(uploadPhotoDirect).not.toHaveBeenCalled();
  });

  // The modal is a proper dialog: role, aria-modal, and a labelled title.
  it("modal is a labelled aria-modal dialog", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    chooseFiles([pngFile("p1.png")]);
    const dialog = modal()!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    // The referenced title node carries the count-aware text.
    expect(document.getElementById(labelledBy!)!.textContent).toBe(
      hub.album.destinationTitle(1),
    );
  });

  // Focus restores to the Add Photos trigger when the modal closes (opened via the device menuitem).
  it("restores focus to the Add Photos trigger on close", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    const trigger = screen.getByRole("button", { name: hub.album.addPhotosMenu });
    openAddMenu();
    fireEvent.click(deviceItem());
    // The menuitem programmatically opens the OS picker; simulate the returned files.
    chooseFiles([pngFile("p1.png")]);
    expect(modal()).not.toBeNull();
    fireEvent.click(cancelBtn());
    expect(document.activeElement).toBe(trigger);
  });

  // #93: the "Add from your device" menuitem opens the hidden OS file picker — it does NOT show a
  // native "choose files" control. Selecting it programmatically clicks the (hidden) file input.
  it("opens the file picker when the device-add menuitem is selected", () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const clicked = vi.spyOn(fileInput, "click");
    openAddMenu();
    fireEvent.click(deviceItem());
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  // #94: the device-add menuitem is no longer gated by the destination selection — choosing files is
  // what OPENS the destination modal, so an empty designator must NOT block the picker.
  it("device-add menuitem is enabled regardless of designator (gate moved to the modal)", () => {
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[]}
      />,
    );
    openAddMenu();
    expect(deviceItem().disabled).toBe(false);
  });

  // #16 multi-select: the file input carries `multiple` so the OS picker allows many files.
  it("marks the file input as multiple (OS multi-select picker)", () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    expect(fileInput.multiple).toBe(true);
  });

  // #16 multi-select · issue #20: after the destination modal's Add, EACH file uploads directly to
  // storage — one uploadPhotoDirect call per file. (Solo-family bypasses the modal; use it here.)
  it("uploads every selected file directly (one call per file)", async () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    chooseFiles([pngFile("p1.png"), pngFile("p2.png"), pngFile("p3.png")]);

    await vi.waitFor(() => expect(uploadPhotoDirect).toHaveBeenCalledTimes(3));
    expect((uploadPhotoDirect.mock.calls[0]![0] as File).name).toBe("p1.png");
    expect((uploadPhotoDirect.mock.calls[2]![0] as File).name).toBe("p3.png");
  });

  // ADR-0015 · F2 board mode: when `onImportFiles` is provided, the uploader HANDS OFF import
  // execution to the board (per-item pool) instead of running the batched action. The modal's Add
  // calls the delegate with the chosen files + familyIds and does NOT call uploadPhotoDirect.
  it("delegates to onImportFiles (board mode) via the modal's Add", async () => {
    const onImportFiles = vi.fn();
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        onImportFiles={onImportFiles}
      />,
    );
    chooseFiles([pngFile("p1.png"), pngFile("p2.png")]);
    // Default seed is FAM_A; complete the add.
    fireEvent.click(addBtn());

    await vi.waitFor(() => expect(onImportFiles).toHaveBeenCalledTimes(1));
    const [files, familyIds] = onImportFiles.mock.calls[0]!;
    expect((files as File[]).map((f) => f.name)).toEqual(["p1.png", "p2.png"]);
    expect(familyIds).toEqual([FAM_A.familyId]);
    expect(uploadPhotoDirect).not.toHaveBeenCalled();
  });

  // Regression · issue #20: the modal's chosen albums ride along as the second arg to each direct
  // upload (the server re-validates). Adding a second album sends BOTH.
  it("sends the chosen albums as familyIds (multi-family)", async () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    chooseFiles([pngFile("p1.png")]);
    // Add the second album to the default (current) selection inside the modal, then Add.
    fireEvent.click(chip(FAM_B.familyName));
    fireEvent.click(addBtn());

    await vi.waitFor(() => expect(uploadPhotoDirect).toHaveBeenCalledTimes(1));
    expect(new Set(uploadPhotoDirect.mock.calls[0]![1] as string[])).toEqual(
      new Set([FAM_A.familyId, FAM_B.familyId]),
    );
  });

  // A partial-success batch (some files failed) surfaces a gentle status note, NOT an error alert.
  it("shows a soft note (not an error) after a partial-success batch", async () => {
    uploadPhotoDirect
      .mockResolvedValueOnce({ ok: true, photoId: "ok-1" })
      .mockResolvedValueOnce({ error: "nope" });
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    chooseFiles([pngFile("p1.png"), pngFile("p2.png")]);

    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/couldn't be added/i),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Regression · issue #20: when EVERY file fails to upload (nothing landed), surface a clear upload
  // error rather than silently doing nothing.
  it("surfaces an error when every file fails to upload", async () => {
    uploadPhotoDirect.mockResolvedValue({ error: "boom" });
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    chooseFiles([pngFile("p1.png")]);

    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/couldn't add/i),
    );
    expect(uploadPhotoDirect).toHaveBeenCalledTimes(1);
  });

  // Regression (Gemini #89): a HARD prepare failure mid-batch (e.g. the 2nd file is HEIC) must not
  // strand the files that already landed. Before the fix the loop returned early on `hardError`
  // WITHOUT `router.refresh()`, so the successfully-uploaded first file stayed invisible until a
  // manual reload. The error is still surfaced, but the router must refresh (added > 0).
  it("refreshes after a hard failure when some files already uploaded (added > 0)", async () => {
    // File 1 prepares + uploads fine; file 2 is a hard prepare failure (HEIC) → breaks the loop.
    prepareAlbumPhoto
      .mockResolvedValueOnce({ ok: true, file: new File([new Uint8Array([1])], "p1.png") })
      .mockResolvedValueOnce({ ok: false, error: "heic_unsupported" });
    // Pin a successful upload for the one file that gets through (a prior test leaves a persistent
    // { error } impl on uploadPhotoDirect that clearAllMocks does not reset).
    uploadPhotoDirect.mockResolvedValueOnce({ ok: true, photoId: "landed-1" });
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    const f2 = new File([new Uint8Array([2])], "p2.heic", { type: "image/heic" });
    fireEvent.change(fileInput, { target: { files: [f1, f2] } });

    // The one file that made it through is uploaded...
    await vi.waitFor(() => expect(uploadPhotoDirect).toHaveBeenCalledTimes(1));
    // ...the hard error is surfaced...
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent?.length).toBeGreaterThan(0),
    );
    // ...and CRUCIALLY the router refreshes so the landed photo appears (the bug: it did not).
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  // Regression (review finding): a batch over the per-batch cap is rejected client-side with a
  // friendly message BEFORE any modal opens, and never spends an upload.
  it("rejects an over-cap batch client-side without a modal or upload", async () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    const tooMany = Array.from({ length: 31 }, (_, i) => pngFile(`p${i}.png`));
    chooseFiles(tooMany);

    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/too many/i),
    );
    expect(modal()).toBeNull();
    expect(uploadPhotoDirect).not.toHaveBeenCalled();
  });

  // ADR-0021 designator: `defaultSelected` (computed by the surface) is the single source of the modal
  // seed. A sole/single family pre-selects it so Add is enabled immediately.
  it("seeds the modal from defaultSelected (sole family pre-selected, Add enabled)", () => {
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[FAM_B.familyId]}
      />,
    );
    chooseFiles([pngFile("p.png")]);
    expect(isOn(FAM_B.familyName)).toBe(true);
    expect(isOn(FAM_A.familyName)).toBe(false);
    expect(addBtn().disabled).toBe(false);
  });

  // A concrete hub scope seeds the modal default (consistency with the ask picker) when no
  // `defaultSelected` is supplied.
  it("seeds the modal default from a concrete hub scope (over the current album)", () => {
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_B.familyId}
        scope={FAM_A.familyId}
      />,
    );
    chooseFiles([pngFile("p.png")]);
    expect(isOn(FAM_A.familyName)).toBe(true);
    expect(isOn(FAM_B.familyName)).toBe(false);
  });
});

describe("AlbumUploader Add Photos menu (#93)", () => {
  // The single trigger is right-justified — its wrapper uses justify-content:flex-end and the menu
  // root itself carries marginLeft:auto (mirrors the old right-pinned Manage-connections slot).
  it("renders one right-justified Add Photos trigger", () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const trigger = screen.getByRole("button", { name: hub.album.addPhotosMenu });
    // The menu root (trigger's parent) is pinned right...
    const menuRoot = trigger.parentElement as HTMLElement;
    expect(menuRoot.style.marginLeft).toBe("auto");
    // ...inside a flex-end row.
    const row = menuRoot.parentElement as HTMLElement;
    expect(row.style.display).toBe("flex");
    expect(row.style.justifyContent).toBe("flex-end");
  });

  // The menu holds only what's available: with device upload only, a single "Add from your device"
  // menuitem — and NO Google/Disconnect rows.
  it("shows only the device-add item when Google is not configured", () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    openAddMenu();
    expect(screen.getByRole("menuitem", { name: hub.album.addFromDevice })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: hub.album.googlePhotosConnect })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: hub.album.googlePhotosImport })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: hub.album.googlePhotosDisconnect })).toBeNull();
  });

  // When there are NO add actions at all (no device upload AND no Google configured) the menu does
  // not render — there is nothing to add.
  it("does not render the menu when there are no add actions", () => {
    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        showFileUpload={false}
      />,
    );
    expect(screen.queryByRole("button", { name: hub.album.addPhotosMenu })).toBeNull();
  });

  it("closes the menu on Escape and on click-outside", () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <AlbumUploader
          families={[FAM_A]}
          currentFamilyId={FAM_A.familyId}
          googlePhotosConfigured
          googlePhotosConnected
        />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: hub.album.addPhotosMenu });

    // Escape closes.
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    // Click-outside closes.
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("AlbumUploader Google Photos", () => {
  it("shows Connect inside the menu when configured but not connected", () => {
    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
      />,
    );
    openAddMenu();
    const connect = screen.getByRole("menuitem", { name: hub.album.googlePhotosConnect });
    expect(connect.getAttribute("href")).toBe("/api/google-photos/connect");
    // Not connected ⇒ no Import, no Disconnect.
    expect(screen.queryByRole("menuitem", { name: hub.album.googlePhotosImport })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: hub.album.googlePhotosDisconnect })).toBeNull();
  });

  // #93: when connected, the menu holds Import + (below a divider) the email header and a Disconnect
  // item. Connect is gone (already connected).
  it("shows Import, the email header, and Disconnect inside the menu when connected", () => {
    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
        googlePhotosEmail="user@gmail.com"
      />,
    );
    // Closed: nothing but the trigger is visible.
    expect(screen.queryByRole("menuitem", { name: hub.album.googlePhotosImport })).toBeNull();
    expect(screen.queryByText("user@gmail.com")).toBeNull();

    openAddMenu();
    expect(screen.getByRole("menuitem", { name: hub.album.googlePhotosImport })).toBeTruthy();
    expect(screen.getByText("user@gmail.com")).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: hub.album.googlePhotosDisconnect }),
    ).toBeTruthy();
    // Connect is not shown when already connected.
    expect(screen.queryByRole("menuitem", { name: hub.album.googlePhotosConnect })).toBeNull();
  });

  it("shows a generic source header inside the menu when email is null", () => {
    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
      />,
    );
    openAddMenu();
    expect(screen.getByText(hub.album.googlePhotosSourceName)).toBeTruthy();
  });

  it("calls disconnectGooglePhotosAction once and refreshes when Disconnect is tapped", async () => {
    disconnectGooglePhotosAction.mockResolvedValueOnce({ ok: true });
    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
        googlePhotosEmail="user@gmail.com"
      />,
    );
    openAddMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: hub.album.googlePhotosDisconnect }),
    );
    await vi.waitFor(() =>
      expect(disconnectGooglePhotosAction).toHaveBeenCalledTimes(1),
    );
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  // Regression: a disconnect that RESOLVES with an { error } shape surfaces that error and does NOT
  // refresh (the connection is still there).
  it("surfaces the error and does not refresh when disconnect returns an { error }", async () => {
    disconnectGooglePhotosAction.mockResolvedValueOnce({ error: "Nope, couldn't disconnect." });
    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
        googlePhotosEmail="user@gmail.com"
      />,
    );
    openAddMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: hub.album.googlePhotosDisconnect }),
    );
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/couldn't disconnect/i),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  // Regression (review finding): the disconnect action can REJECT (throw) at the transport level
  // rather than return an { error } shape. Without a catch, the rejection is swallowed by the
  // transition — the menu hangs on "Disconnecting…" with no error and no retry. It must surface a
  // clear error instead (mirrors the upload-throws hardening).
  it("surfaces an error when the disconnect action throws (does not hang silently)", async () => {
    disconnectGooglePhotosAction.mockRejectedValueOnce(new Error("network dropped"));
    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
        googlePhotosEmail="user@gmail.com"
      />,
    );
    openAddMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: hub.album.googlePhotosDisconnect }),
    );
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        new RegExp(hub.album.googlePhotosDisconnectError, "i"),
      ),
    );
    expect(disconnectGooglePhotosAction).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("hides file upload but keeps the Connect item when showFileUpload is false", () => {
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        showFileUpload={false}
        googlePhotosConfigured
      />,
    );
    openAddMenu();
    // No device-add item (upload hidden)...
    expect(screen.queryByRole("menuitem", { name: hub.album.addFromDevice })).toBeNull();
    // ...but the Google Connect item is still there.
    expect(screen.getByRole("menuitem", { name: hub.album.googlePhotosConnect })).toBeTruthy();
  });

  it("surfaces OAuth connected flash and strips query params", async () => {
    window.history.replaceState({}, "", "/hub?tab=album&googlePhotos=connected");

    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosOauthConnected
      />,
    );

    expect(await screen.findByText(hub.album.googlePhotosConnectedSuccess)).toBeTruthy();
    expect(replace).toHaveBeenCalledWith("/hub?tab=album");
  });

  // Regression: window.open(..., "noopener") returns null EVEN WHEN the picker opened.
  // Treating that as "blocked" aborted import before poll/complete — picker visible, photos never
  // landed. Open as a sized popup (no noopener feature) and keep polling when a Window is returned.
  it("opens the picker as a sized popup (not noopener) and completes import after mediaItemsSet", async () => {
    const popup = { closed: false, close: vi.fn(), opener: window as unknown };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    startGooglePhotosImportAction.mockResolvedValueOnce({
      ok: true,
      sessionId: "sess-1",
      pickerUri: "https://photospicker.googleapis.com/v1/picker/sess-1",
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });
    pollGooglePhotosImportAction.mockResolvedValueOnce({ ok: true, mediaItemsSet: true });
    completeGooglePhotosImportAction.mockResolvedValueOnce({
      ok: true,
      added: 2,
      failed: 0,
      skipped: 0,
      rejected: 0,
    });

    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
      />,
    );
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: hub.album.googlePhotosImport }));

    await vi.waitFor(() => expect(completeGooglePhotosImportAction).toHaveBeenCalledTimes(1));
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0]!;
    expect(String(url)).toContain("/autoclose");
    expect(target).toBe("chronicle-google-photos-picker");
    expect(String(features)).toMatch(/popup=yes/);
    expect(String(features)).not.toMatch(/noopener/);
    // Same protection as noopener, without losing the Window handle for the blocked check.
    expect(popup.opener).toBeNull();
    expect(pollGooglePhotosImportAction).toHaveBeenCalledWith("sess-1");
    expect(refresh).toHaveBeenCalled();
    openSpy.mockRestore();
  });

  // ADR-0021 · #94: the Google import path applies the SAME destination modal as file upload. After the
  // picker completes, a >1-family viewer picks the destination in the modal; only on Add does the
  // completion fire with the chosen `familyIds` (server re-validates), proving both add paths share the
  // modal identically.
  it("routes Google import through the destination modal (multi-family) and threads the chosen familyIds", async () => {
    const popup = { closed: false, close: vi.fn(), opener: window as unknown };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    startGooglePhotosImportAction.mockResolvedValueOnce({
      ok: true,
      sessionId: "sess-1",
      pickerUri: "https://photos.google.com/picker?sessionId=sess-1",
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });
    pollGooglePhotosImportAction.mockResolvedValueOnce({ ok: true, mediaItemsSet: true });
    completeGooglePhotosImportAction.mockResolvedValueOnce({
      ok: true,
      added: 1,
      failed: 0,
      skipped: 0,
      rejected: 0,
    });

    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[FAM_B.familyId]}
        googlePhotosConfigured
        googlePhotosConnected
      />,
    );
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: hub.album.googlePhotosImport }));

    // The picker completes → the destination modal opens (count-agnostic title). Nothing imported yet.
    await vi.waitFor(() => expect(modal()).not.toBeNull());
    expect(screen.getByText(hub.album.destinationTitleGeneric)).toBeTruthy();
    expect(completeGooglePhotosImportAction).not.toHaveBeenCalled();
    // Seeded to the designator (FAM_B); Add completes the import with that family.
    expect(isOn(FAM_B.familyName)).toBe(true);
    fireEvent.click(addBtn());

    await vi.waitFor(() => expect(completeGooglePhotosImportAction).toHaveBeenCalledTimes(1));
    const formData = completeGooglePhotosImportAction.mock.calls[0]![0] as FormData;
    expect(formData.getAll("familyIds")).toEqual([FAM_B.familyId]);
    openSpy.mockRestore();
  });

  // #94: an AMBIGUOUS Google import (empty designator, >1 family) is blocked at the MODAL, not the
  // menuitem — the Import item stays enabled (it opens the picker), and the modal's Add is disabled
  // until a deliberate pick, so no import fans out to all families.
  it("Google import item stays enabled; the modal's Add gates the ambiguous case", async () => {
    const popup = { closed: false, close: vi.fn(), opener: window as unknown };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    startGooglePhotosImportAction.mockResolvedValueOnce({
      ok: true,
      sessionId: "sess-1",
      pickerUri: "https://photos.google.com/picker?sessionId=sess-1",
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });
    pollGooglePhotosImportAction.mockResolvedValueOnce({ ok: true, mediaItemsSet: true });

    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[]}
        googlePhotosConfigured
        googlePhotosConnected
      />,
    );
    openAddMenu();
    const importItem = screen.getByRole("menuitem", {
      name: hub.album.googlePhotosImport,
    }) as HTMLButtonElement;
    // The item itself is NOT disabled by the empty designator (it opens the picker).
    expect(importItem.disabled).toBe(false);
    fireEvent.click(importItem);

    // Picker completes → modal opens blank → Add disabled until a pick.
    await vi.waitFor(() => expect(modal()).not.toBeNull());
    expect(addBtn().disabled).toBe(true);
    openSpy.mockRestore();
  });

  it("opens a photos.google.com pickerUri (the real user-facing host)", async () => {
    const popup = { closed: false, close: vi.fn(), opener: window as unknown };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    startGooglePhotosImportAction.mockResolvedValueOnce({
      ok: true,
      sessionId: "sess-1",
      pickerUri: "https://photos.google.com/picker?sessionId=sess-1",
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });
    pollGooglePhotosImportAction.mockResolvedValueOnce({ ok: true, mediaItemsSet: true });
    completeGooglePhotosImportAction.mockResolvedValueOnce({
      ok: true,
      added: 1,
      failed: 0,
      skipped: 0,
      rejected: 0,
    });

    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
      />,
    );
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: hub.album.googlePhotosImport }));

    await vi.waitFor(() => expect(completeGooglePhotosImportAction).toHaveBeenCalledTimes(1));
    expect(String(openSpy.mock.calls[0]![0])).toBe(
      "https://photos.google.com/picker?sessionId=sess-1",
    );
    openSpy.mockRestore();
  });

  it("rejects a non-Google pickerUri without opening a window", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    startGooglePhotosImportAction.mockResolvedValueOnce({
      ok: true,
      sessionId: "sess-1",
      pickerUri: "https://evil.example/picker",
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });

    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
      />,
    );
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: hub.album.googlePhotosImport }));

    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/couldn't import/i),
    );
    expect(openSpy).not.toHaveBeenCalled();
    expect(pollGooglePhotosImportAction).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("shows popup-blocked when window.open returns null (truly blocked)", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    startGooglePhotosImportAction.mockResolvedValueOnce({
      ok: true,
      sessionId: "sess-1",
      pickerUri: "https://photospicker.googleapis.com/v1/picker/sess-1",
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });

    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
      />,
    );
    openAddMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: hub.album.googlePhotosImport }));

    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/blocked/i),
    );
    expect(pollGooglePhotosImportAction).not.toHaveBeenCalled();
    expect(completeGooglePhotosImportAction).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
