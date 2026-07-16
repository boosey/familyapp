// @vitest-environment jsdom
/**
 * AlbumUploader — the multi-family placement picker (#16) + the button-opens-picker upload flow,
 * now driven through the consolidated "Add Photos ▾" dropdown (#93).
 *  1. In >=2 families: one chip per family; ONLY the current-context family is ON by
 *     default (the default is the album on screen, never "all").
 *  2. Solo (one family): no placement chips render — the server defaults to the sole family.
 *  3. Deselecting the last ON album disables the "Add from your device" menuitem (>=1 must stay
 *     selected).
 *  4. Choosing files in the (hidden) input IS the upload — there is no separate submit step.
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

describe("AlbumUploader multi-family picker", () => {
  it("checks ONLY the current-context family by default (not all)", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_B.familyId} />,
    );
    expect(isOn(FAM_B.familyName)).toBe(true);
    expect(isOn(FAM_A.familyName)).toBe(false);
  });

  it("renders NO checkboxes for a solo-family contributor", () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    expect(screen.queryByRole("button", { name: FAM_A.familyName })).toBeNull();
  });

  it("disables the device-add menuitem when the only checked album is deselected", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    openAddMenu();
    // With the current album checked by default, the device-add item is enabled...
    expect(deviceItem().disabled).toBe(false);
    // ...deselecting the sole ON album disables it (>=1 must stay selected).
    fireEvent.click(chip(FAM_A.familyName));
    expect(deviceItem().disabled).toBe(true);
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

  // #16 multi-select: the file input carries `multiple` so the OS picker allows many files.
  it("marks the file input as multiple (OS multi-select picker)", () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    expect(fileInput.multiple).toBe(true);
  });

  // #16 multi-select · issue #20: selecting several files uploads EACH ONE directly to storage — one
  // uploadPhotoDirect call per file. Choosing files IS the upload — no separate submit step.
  it("uploads every selected file directly (one call per file)", async () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1, 2, 3])], "p1.png", { type: "image/png" });
    const f2 = new File([new Uint8Array([4, 5, 6])], "p2.png", { type: "image/png" });
    const f3 = new File([new Uint8Array([7, 8, 9])], "p3.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1, f2, f3] } });

    await vi.waitFor(() => expect(uploadPhotoDirect).toHaveBeenCalledTimes(3));
    // Each call carries the prepared File as its first arg.
    expect((uploadPhotoDirect.mock.calls[0]![0] as File).name).toBe("p1.png");
    expect((uploadPhotoDirect.mock.calls[2]![0] as File).name).toBe("p3.png");
  });

  // ADR-0015 · F2 board mode: when `onImportFiles` is provided, the uploader HANDS OFF import
  // execution to the board (per-item pool) instead of running the batched action. Choosing files calls
  // the delegate with the chosen files + familyIds and does NOT call uploadPhotoDirect.
  it("delegates to onImportFiles (board mode) instead of calling the direct upload", async () => {
    const onImportFiles = vi.fn();
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        onImportFiles={onImportFiles}
      />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    const f2 = new File([new Uint8Array([2])], "p2.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1, f2] } });

    await vi.waitFor(() => expect(onImportFiles).toHaveBeenCalledTimes(1));
    const [files, familyIds] = onImportFiles.mock.calls[0]!;
    expect((files as File[]).map((f) => f.name)).toEqual(["p1.png", "p2.png"]);
    // Default selection is the current-context family, handed to the board.
    expect(familyIds).toEqual([FAM_A.familyId]);
    // The direct-upload path is NOT taken in board mode (the board owns import).
    expect(uploadPhotoDirect).not.toHaveBeenCalled();
  });

  // Regression · issue #20: the multi-family picker's checked albums ride along as the second arg to
  // each direct upload (the server re-validates). Checking a second album sends BOTH.
  it("sends the checked albums as familyIds (multi-family)", async () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    // Add the second album to the default (current) selection, then choose a file.
    fireEvent.click(chip(FAM_B.familyName));
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1] } });

    await vi.waitFor(() => expect(uploadPhotoDirect).toHaveBeenCalledTimes(1));
    expect(new Set(uploadPhotoDirect.mock.calls[0]![1] as string[])).toEqual(
      new Set([FAM_A.familyId, FAM_B.familyId]),
    );
  });

  // Regression · issue #20: a solo-family contributor sends NO familyIds — the server defaults to the
  // sole family. (No picker is shown, so nothing to select.)
  it("sends NO familyIds for a solo-family contributor", async () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1] } });

    await vi.waitFor(() => expect(uploadPhotoDirect).toHaveBeenCalledTimes(1));
    expect(uploadPhotoDirect.mock.calls[0]![1]).toEqual([]);
  });

  // A partial-success batch (some files failed) surfaces a gentle status note, NOT an error alert.
  it("shows a soft note (not an error) after a partial-success batch", async () => {
    // Two files: the first lands, the second fails → a partial success note.
    uploadPhotoDirect
      .mockResolvedValueOnce({ ok: true, photoId: "ok-1" })
      .mockResolvedValueOnce({ error: "nope" });
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    const f2 = new File([new Uint8Array([2])], "p2.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1, f2] } });

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
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1] } });

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
  // friendly message and never spends an upload (the count cap is a UX guard — ADR-0015).
  it("rejects an over-cap batch client-side without uploading", async () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const tooMany = Array.from(
      { length: 31 },
      (_, i) => new File([new Uint8Array([i])], `p${i}.png`, { type: "image/png" }),
    );
    fireEvent.change(fileInput, { target: { files: tooMany } });

    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/too many/i),
    );
    expect(uploadPhotoDirect).not.toHaveBeenCalled();
  });

  // Regression: the family switcher is a same-route soft navigation, so this client component is
  // NOT remounted — only `currentFamilyId` changes. The picker default must follow the new context
  // (default = the album on screen), not stay stuck on the family it first mounted with.
  it("re-defaults the picker to the new current family when currentFamilyId changes (no remount)", () => {
    const { rerender } = render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    expect(isOn(FAM_A.familyName)).toBe(true);
    expect(isOn(FAM_B.familyName)).toBe(false);

    // Same component instance, new context family (mirrors the switcher's prop-only change).
    rerender(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_B.familyId} />,
    );
    expect(isOn(FAM_B.familyName)).toBe(true);
    expect(isOn(FAM_A.familyName)).toBe(false);
  });

  // Consistency with the ask picker (Task 3): a concrete non-"all" hub scope seeds the default even
  // when it differs from the current-album context. Here scope names FAM_A while the album on screen
  // is FAM_B — the scope wins.
  it("seeds the default from a concrete hub scope (over the current album)", () => {
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_B.familyId}
        scope={FAM_A.familyId}
      />,
    );
    expect(isOn(FAM_A.familyName)).toBe(true);
    expect(isOn(FAM_B.familyName)).toBe(false);
  });

  // scope="all" is ambiguous, so the current-album context still wins (behavior unchanged from before
  // the scope prop existed). Precedence: a concrete family scope overrides; "all" defers.
  it('defers to the current album when scope is "all"', () => {
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_B.familyId}
        scope="all"
      />,
    );
    expect(isOn(FAM_B.familyName)).toBe(true);
    expect(isOn(FAM_A.familyName)).toBe(false);
  });

  // ADR-0021 designator: `defaultSelected` (computed by the surface) is the single source of the seed.
  // A sole/single family pre-selects it so upload proceeds with no extra picking (device-add enabled).
  it("seeds the designator from defaultSelected (sole family pre-selected, device-add enabled)", () => {
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[FAM_B.familyId]}
      />,
    );
    expect(isOn(FAM_B.familyName)).toBe(true);
    expect(isOn(FAM_A.familyName)).toBe(false);
    // A concrete target ⇒ the device-add menuitem is enabled (upload can proceed).
    openAddMenu();
    expect(deviceItem().disabled).toBe(false);
  });

  // ADR-0021 designator: an AMBIGUOUS target (viewer has >1 family, filter names none) arrives as an
  // EMPTY `defaultSelected` → NOTHING is pre-selected and the device-add item is DISABLED until a
  // deliberate pick. A photo never silently fans out to all families.
  it("defaults to NO selection (device-add disabled) when defaultSelected is empty (ambiguous target)", () => {
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[]}
      />,
    );
    expect(isOn(FAM_A.familyName)).toBe(false);
    expect(isOn(FAM_B.familyName)).toBe(false);
    openAddMenu();
    expect(deviceItem().disabled).toBe(true);
    // A deliberate pick enables it.
    fireEvent.click(chip(FAM_A.familyName));
    expect(deviceItem().disabled).toBe(false);
  });

  // ADR-0021: `defaultSelected` supersedes `scope` (the surface owns the sole/ambiguous rule). An empty
  // default forces a pick even if a concrete scope is also passed.
  it("defaultSelected (empty) overrides a concrete scope — the designator rule wins", () => {
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        scope={FAM_A.familyId}
        defaultSelected={[]}
      />,
    );
    expect(isOn(FAM_A.familyName)).toBe(false);
    expect(isOn(FAM_B.familyName)).toBe(false);
  });

  // ADR-0021: a filter change is a same-route soft navigation (no remount) — a new `defaultSelected`
  // re-seeds the designator WITHOUT the uploader ever writing back to `?families=`.
  it("re-seeds when defaultSelected changes (no remount, no write-back)", () => {
    const { rerender } = render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[FAM_A.familyId]}
      />,
    );
    expect(isOn(FAM_A.familyName)).toBe(true);

    rerender(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[FAM_B.familyId]}
      />,
    );
    expect(isOn(FAM_B.familyName)).toBe(true);
    expect(isOn(FAM_A.familyName)).toBe(false);
    // The uploader never navigates (no write-back to the browse filter).
    expect(replace).not.toHaveBeenCalled();
  });

  // A scope change is a same-route soft navigation (no remount) — the default must re-seed to the new
  // scope, just like a currentFamilyId change does. The prevKey folds BOTH signals.
  it("re-seeds when the scope prop changes (no remount)", () => {
    const { rerender } = render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        scope="all"
      />,
    );
    // "all" → current album (FAM_A) is the default.
    expect(isOn(FAM_A.familyName)).toBe(true);
    expect(isOn(FAM_B.familyName)).toBe(false);

    // Scope narrows to FAM_B while the mount stays; the default follows.
    rerender(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        scope={FAM_B.familyId}
      />,
    );
    expect(isOn(FAM_B.familyName)).toBe(true);
    expect(isOn(FAM_A.familyName)).toBe(false);
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

  // ADR-0021: the Google import path applies the SAME family DESIGNATOR selection as file upload. With
  // a multi-family viewer the picker's `defaultSelected` seed is threaded into the completed import's
  // `familyIds` (server re-validates), proving the designator governs both add paths identically.
  it("threads the designator selection into the Google import familyIds", async () => {
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

    await vi.waitFor(() => expect(completeGooglePhotosImportAction).toHaveBeenCalledTimes(1));
    const formData = completeGooglePhotosImportAction.mock.calls[0]![0] as FormData;
    // Only the designator's family (FAM_B) rides along — not the current-album FAM_A.
    expect(formData.getAll("familyIds")).toEqual([FAM_B.familyId]);
    openSpy.mockRestore();
  });

  // ADR-0021: an AMBIGUOUS Google import (empty designator, >1 family) is blocked at the item — the
  // Import menuitem is disabled until a deliberate pick, so no import fans out to all families.
  it("disables the Google import item when the designator is empty (ambiguous, >1 family)", () => {
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
    expect(importItem.disabled).toBe(true);
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
