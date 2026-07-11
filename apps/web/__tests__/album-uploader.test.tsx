// @vitest-environment jsdom
/**
 * AlbumUploader — the multi-family placement picker (#16) + the button-opens-picker upload flow.
 *  1. In >=2 families: one checkbox per family; ONLY the current-context family is checked by
 *     default (the default is the album on screen, never "all").
 *  2. Solo (one family): no checkboxes render — the server defaults to the sole family.
 *  3. Deselecting the last checked album disables the "Add to album" button (>=1 must stay selected).
 *  4. Choosing files in the (hidden) input IS the upload — there is no separate submit step.
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

const uploadAlbumPhotoAction = vi.fn(
  async (..._args: unknown[]): Promise<{ ok: true; added: number; failed: number }> => ({
    ok: true,
    added: 1,
    failed: 0,
  }),
);
vi.mock("@/app/hub/album/actions", () => ({
  uploadAlbumPhotoAction: (...args: unknown[]) => uploadAlbumPhotoAction(...args),
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

describe("AlbumUploader multi-family picker", () => {
  it("checks ONLY the current-context family by default (not all)", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_B.familyId} />,
    );
    const a = screen.getByLabelText(FAM_A.familyName) as HTMLInputElement;
    const b = screen.getByLabelText(FAM_B.familyName) as HTMLInputElement;
    expect(b.checked).toBe(true);
    expect(a.checked).toBe(false);
  });

  it("renders NO checkboxes for a solo-family contributor", () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("disables the add button when the only checked album is deselected", () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    const add = screen.getByRole("button", { name: /add to album/i }) as HTMLButtonElement;
    // With the current album checked by default, the button is enabled...
    expect(add.disabled).toBe(false);
    // ...deselecting the sole checked album disables it (>=1 must stay selected).
    const a = screen.getByLabelText(FAM_A.familyName) as HTMLInputElement;
    fireEvent.click(a);
    expect(add.disabled).toBe(true);
  });

  // The visible "Add to album" button opens the hidden OS file picker — it does NOT show a native
  // "choose files" control. Clicking it programmatically clicks the (hidden) file input.
  it("opens the file picker when the add button is clicked", () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const clicked = vi.spyOn(fileInput, "click");
    fireEvent.click(screen.getByRole("button", { name: /add to album/i }));
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

  // #16 multi-select: selecting several files sends ALL of them to the action as repeated `photo`
  // FormData entries (each becomes its own album photo, same chosen album[s]). Choosing files IS the
  // upload — no separate submit step.
  it("submits every selected file as a separate `photo` entry", async () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1, 2, 3])], "p1.png", { type: "image/png" });
    const f2 = new File([new Uint8Array([4, 5, 6])], "p2.png", { type: "image/png" });
    const f3 = new File([new Uint8Array([7, 8, 9])], "p3.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1, f2, f3] } });

    await vi.waitFor(() => expect(uploadAlbumPhotoAction).toHaveBeenCalledTimes(1));
    const formData = uploadAlbumPhotoAction.mock.calls[0]![0] as FormData;
    const photos = formData.getAll("photo");
    expect(photos).toHaveLength(3);
    expect((photos[0] as File).name).toBe("p1.png");
    expect((photos[2] as File).name).toBe("p3.png");
  });

  // ADR-0015 · F2 board mode: when `onImportFiles` is provided, the uploader HANDS OFF import
  // execution to the board (per-item pool) instead of running the batched action. Choosing files calls
  // the delegate with the chosen files + familyIds and does NOT call uploadAlbumPhotoAction.
  it("delegates to onImportFiles (board mode) instead of calling the batched action", async () => {
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
    // The batched action is NOT called in board mode.
    expect(uploadAlbumPhotoAction).not.toHaveBeenCalled();
  });

  // Regression: the multi-family picker's checked albums must ride along in the payload. The upload
  // now builds FormData explicitly (rather than serializing a <form>), so the selected `familyIds`
  // come from the picker state, not from the DOM. Checking a second album sends BOTH.
  it("sends the checked albums as `familyIds` entries (multi-family)", async () => {
    render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    // Add the second album to the default (current) selection, then choose a file.
    fireEvent.click(screen.getByLabelText(FAM_B.familyName));
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1] } });

    await vi.waitFor(() => expect(uploadAlbumPhotoAction).toHaveBeenCalledTimes(1));
    const formData = uploadAlbumPhotoAction.mock.calls[0]![0] as FormData;
    expect(new Set(formData.getAll("familyIds"))).toEqual(
      new Set([FAM_A.familyId, FAM_B.familyId]),
    );
  });

  // Regression: a solo-family contributor sends NO `familyIds` — the server defaults to the sole
  // family. (No picker is shown, so nothing to serialize.)
  it("sends NO `familyIds` for a solo-family contributor", async () => {
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1] } });

    await vi.waitFor(() => expect(uploadAlbumPhotoAction).toHaveBeenCalledTimes(1));
    const formData = uploadAlbumPhotoAction.mock.calls[0]![0] as FormData;
    expect(formData.getAll("familyIds")).toHaveLength(0);
  });

  // A partial-success batch (some files failed) surfaces a gentle status note, NOT an error alert.
  it("shows a soft note (not an error) after a partial-success batch", async () => {
    uploadAlbumPhotoAction.mockResolvedValueOnce({ ok: true, added: 2, failed: 1 });
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1] } });

    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/couldn't be added/i),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Regression (review finding): the action can REJECT (e.g. the request body exceeds the Server
  // Action / platform size limit) rather than return an { error } shape. That rejection must surface a
  // clear message, not be swallowed by the transition so the upload silently does nothing.
  it("surfaces an error when the upload action throws (does not fail silently)", async () => {
    uploadAlbumPhotoAction.mockRejectedValueOnce(new Error("Body exceeded 1 MB limit"));
    render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "p1.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [f1] } });

    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/too large/i),
    );
    expect(uploadAlbumPhotoAction).toHaveBeenCalledTimes(1);
  });

  // Regression (review finding): a batch over the per-batch cap is rejected client-side with a
  // friendly message and never spends an upload (the server enforces the same cap authoritatively).
  it("rejects an over-cap batch client-side without calling the action", async () => {
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
    expect(uploadAlbumPhotoAction).not.toHaveBeenCalled();
  });

  // Regression: the family switcher is a same-route soft navigation, so this client component is
  // NOT remounted — only `currentFamilyId` changes. The picker default must follow the new context
  // (default = the album on screen), not stay stuck on the family it first mounted with.
  it("re-defaults the picker to the new current family when currentFamilyId changes (no remount)", () => {
    const { rerender } = render(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_A.familyId} />,
    );
    expect((screen.getByLabelText(FAM_A.familyName) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(FAM_B.familyName) as HTMLInputElement).checked).toBe(false);

    // Same component instance, new context family (mirrors the switcher's prop-only change).
    rerender(
      <AlbumUploader families={[FAM_A, FAM_B]} currentFamilyId={FAM_B.familyId} />,
    );
    expect((screen.getByLabelText(FAM_B.familyName) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(FAM_A.familyName) as HTMLInputElement).checked).toBe(false);
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
    expect((screen.getByLabelText(FAM_A.familyName) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(FAM_B.familyName) as HTMLInputElement).checked).toBe(false);
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
    expect((screen.getByLabelText(FAM_B.familyName) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(FAM_A.familyName) as HTMLInputElement).checked).toBe(false);
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
    expect((screen.getByLabelText(FAM_A.familyName) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(FAM_B.familyName) as HTMLInputElement).checked).toBe(false);

    // Scope narrows to FAM_B while the mount stays; the default follows.
    rerender(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        scope={FAM_B.familyId}
      />,
    );
    expect((screen.getByLabelText(FAM_B.familyName) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(FAM_A.familyName) as HTMLInputElement).checked).toBe(false);
  });
});

describe("AlbumUploader Google Photos", () => {
  it("shows Connect when configured but not connected", () => {
    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
      />,
    );
    const connect = screen.getByRole("link", { name: hub.album.googlePhotosConnect });
    expect(connect.getAttribute("href")).toBe("/api/google-photos/connect");
    expect(screen.queryByRole("button", { name: hub.album.googlePhotosImport })).toBeNull();
  });

  // The inline Disconnect button and the standalone email status line are GONE — Disconnect now lives
  // inside a right-aligned "Manage connections ▾" dropdown, and the email is a header inside that menu.
  it("shows Import and a Manage connections trigger (no inline Disconnect / email) when connected", () => {
    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
        googlePhotosEmail="user@gmail.com"
      />,
    );
    expect(screen.getByRole("button", { name: hub.album.googlePhotosImport })).toBeTruthy();
    // The trigger is visible...
    expect(screen.getByRole("button", { name: hub.album.manageConnections })).toBeTruthy();
    // ...but the raw Disconnect item and the email are hidden until the menu opens.
    expect(screen.queryByRole("menuitem", { name: hub.album.googlePhotosDisconnect })).toBeNull();
    expect(screen.queryByText("user@gmail.com")).toBeNull();
  });

  it("renders the Manage connections trigger only when connected", () => {
    // Unconfigured: no trigger.
    const { rerender } = render(
      <AlbumUploader families={[FAM_A]} currentFamilyId={FAM_A.familyId} />,
    );
    expect(screen.queryByRole("button", { name: hub.album.manageConnections })).toBeNull();

    // Configured but NOT connected: still no trigger (the inline Connect link owns that state).
    rerender(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
      />,
    );
    expect(screen.queryByRole("button", { name: hub.album.manageConnections })).toBeNull();

    // Connected: the trigger appears.
    rerender(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
      />,
    );
    expect(screen.getByRole("button", { name: hub.album.manageConnections })).toBeTruthy();
  });

  it("opens a menu with the email header and a Disconnect item", () => {
    render(
      <AlbumUploader
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        googlePhotosConfigured
        googlePhotosConnected
        googlePhotosEmail="user@gmail.com"
      />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: hub.album.manageConnections }));
    expect(screen.getByRole("menu")).toBeTruthy();
    // Email is the header inside the open menu.
    expect(screen.getByText("user@gmail.com")).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: hub.album.googlePhotosDisconnect }),
    ).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: hub.album.manageConnections }));
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
    fireEvent.click(screen.getByRole("button", { name: hub.album.manageConnections }));
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
    fireEvent.click(screen.getByRole("button", { name: hub.album.manageConnections }));
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
    fireEvent.click(screen.getByRole("button", { name: hub.album.manageConnections }));
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

  it("closes the Manage connections menu on Escape and on click-outside", () => {
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
    const trigger = screen.getByRole("button", { name: hub.album.manageConnections });

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

  it("hides file upload but keeps Google chrome when showFileUpload is false", () => {
    render(
      <AlbumUploader
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        showFileUpload={false}
        googlePhotosConfigured
      />,
    );
    expect(screen.queryByRole("button", { name: hub.album.addButton })).toBeNull();
    expect(screen.getByRole("link", { name: hub.album.googlePhotosConnect })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: hub.album.googlePhotosImport }));

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
    fireEvent.click(screen.getByRole("button", { name: hub.album.googlePhotosImport }));

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
    fireEvent.click(screen.getByRole("button", { name: hub.album.googlePhotosImport }));

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
    fireEvent.click(screen.getByRole("button", { name: hub.album.googlePhotosImport }));

    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/blocked/i),
    );
    expect(pollGooglePhotosImportAction).not.toHaveBeenCalled();
    expect(completeGooglePhotosImportAction).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
