// @vitest-environment jsdom
/**
 * AlbumBoard (ADR-0015 · F2 · issue #20) — the client wrapper that owns per-item import state and
 * drives import through a bounded concurrency pool. It hands the uploader an `onImportFiles` /
 * `onImportGoogle` delegate, creates one placeholder tile per photo, and runs ONE per-item import per
 * photo: file uploads go through the direct-to-storage helper `uploadPhotoDirect(file, familyIds)`
 * (issue #20 — bytes straight to storage, then record), Google imports through
 * `importOneGooglePhotoAction`. A per-item failure marks ONLY that tile failed (tap-to-retry); the
 * pool never runs more than IMPORT_POOL_CONCURRENCY at once; a live "X of N" reflects completions.
 *
 * Mocks next/navigation, direct-upload, the google-photos-actions module, and prepare-photo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AlbumBoard } from "@/app/hub/album/AlbumBoard";
import { hub } from "@/app/_copy";
import { IMPORT_POOL_CONCURRENCY } from "@/app/hub/album/import-progress";

const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace }),
}));

// The per-item import returns the created photo's id (ADR-0015 optimistic tile). A monotonic counter
// gives each success a distinct id so loaded tiles render distinct <img> bytes.
let photoSeq = 0;
const okPhoto = (): { ok: true; photoId: string } => ({
  ok: true,
  photoId: `photo-${(photoSeq += 1)}`,
});

// issue #20 — the board's file-upload path calls uploadPhotoDirect(file, familyIds) (request target →
// PUT bytes → record). The tests drive its result directly; args are [file, familyIds].
const uploadPhotoDirect = vi.fn(
  async (
    ..._args: unknown[]
  ): Promise<{ ok: true; photoId: string } | { error: string }> => okPhoto(),
);
vi.mock("@/app/hub/album/direct-upload", () => ({
  uploadPhotoDirect: (...args: unknown[]) => uploadPhotoDirect(...args),
}));

const listGooglePhotosImportAction = vi.fn();
const importOneGooglePhotoAction = vi.fn(
  async (..._args: unknown[]): Promise<{ ok: true; photoId: string } | { error: string }> =>
    okPhoto(),
);
const startGooglePhotosImportAction = vi.fn();
const pollGooglePhotosImportAction = vi.fn();
const completeGooglePhotosImportAction = vi.fn();
const disconnectGooglePhotosAction = vi.fn();
vi.mock("@/app/hub/album/google-photos-actions", () => ({
  listGooglePhotosImportAction: (...args: unknown[]) => listGooglePhotosImportAction(...args),
  importOneGooglePhotoAction: (...args: unknown[]) => importOneGooglePhotoAction(...args),
  startGooglePhotosImportAction: (...args: unknown[]) => startGooglePhotosImportAction(...args),
  pollGooglePhotosImportAction: (...args: unknown[]) => pollGooglePhotosImportAction(...args),
  completeGooglePhotosImportAction: (...args: unknown[]) =>
    completeGooglePhotosImportAction(...args),
  disconnectGooglePhotosAction: (...args: unknown[]) => disconnectGooglePhotosAction(...args),
}));

const prepareAlbumPhoto = vi.fn(
  async (file: File): Promise<{ ok: true; file: File } | { ok: false; error: string }> => ({
    ok: true,
    file,
  }),
);
vi.mock("@/app/hub/album/prepare-photo", () => ({
  prepareAlbumPhoto: (file: File) => prepareAlbumPhoto(file),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // reset default impls (clearAllMocks wipes impls set via mockResolvedValueOnce but not the base fn)
  uploadPhotoDirect.mockImplementation(async () => okPhoto());
  importOneGooglePhotoAction.mockImplementation(async () => okPhoto());
  prepareAlbumPhoto.mockImplementation(async (file: File) => ({ ok: true, file }));
});

const FAM_A = { familyId: "aaaaaaaa-0000-0000-0000-000000000000", familyName: "Esposito" };
const FAM_B = { familyId: "bbbbbbbb-0000-0000-0000-000000000000", familyName: "Marino" };

function makeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

function renderBoard(props?: Partial<React.ComponentProps<typeof AlbumBoard>>) {
  return render(
    <AlbumBoard
      families={[FAM_A]}
      currentFamilyId={FAM_A.familyId}
      defaultSelected={[FAM_A.familyId]}
      viewedFamilyIds={[FAM_A.familyId]}
      uploaderScope="all"
      showFileUpload
      googlePhotosConfigured={false}
      googlePhotosConnected={false}
      googlePhotosEmail={null}
      googlePhotosOauthConnected={false}
      googlePhotosOauthError={null}
      photos={[]}
      {...props}
    />,
  );
}

function chooseFiles(names: string[]) {
  const fileInput = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: names.map(makeFile) } });
}

/** #93 — open the consolidated "Add Photos ▾" dropdown so its menuitems become clickable. */
function openAddMenu() {
  fireEvent.click(screen.getByRole("button", { name: hub.album.addPhotosMenu }));
}
/** Open the menu then click the "Import from Google Photos" menuitem (connected sources only). */
function clickGoogleImport() {
  openAddMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: hub.album.googlePhotosImport }));
}

/** A promise you can resolve/reject from the test to control an action's timing. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("AlbumBoard file upload (exact-N per-item pool)", () => {
  it("choosing K files creates exactly K placeholder tiles and calls the per-item action K times", async () => {
    renderBoard();
    chooseFiles(["p1.png", "p2.png", "p3.png"]);

    await waitFor(() =>
      expect(uploadPhotoDirect).toHaveBeenCalledTimes(3),
    );
    // Each success removes its tile → no importing tiles left, and refresh fired.
    await waitFor(() =>
      expect(screen.queryByLabelText(hub.album.importingTile)).toBeNull(),
    );
    expect(refresh).toHaveBeenCalled();
    // Each call carried the file as a `photo` entry.
    // The first arg is the single prepared File; the second is the chosen familyIds.
    expect(uploadPhotoDirect.mock.calls[0]![0]).toBeInstanceOf(File);
  });

  it("prepares each file per-item; a prepare failure marks ONLY that tile failed", async () => {
    prepareAlbumPhoto.mockImplementation(async (file: File) =>
      file.name === "bad.png"
        ? { ok: false, error: "too_large" }
        : { ok: true, file },
    );
    renderBoard();
    chooseFiles(["good1.png", "bad.png", "good2.png"]);

    // The two good ones upload; the bad one never reaches the action.
    await waitFor(() =>
      expect(uploadPhotoDirect).toHaveBeenCalledTimes(2),
    );
    // Exactly one failed tile with a retry affordance survives.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: hub.album.retryImportTile })).toBeTruthy(),
    );
    expect(screen.getAllByRole("button", { name: hub.album.retryImportTile })).toHaveLength(1);
  });

  it("a per-item action { error } marks ONLY that tile failed; others still land", async () => {
    uploadPhotoDirect.mockImplementation(async (...args: unknown[]) => {
      const name = (args[0] as File).name;
      return name === "boom.png" ? { error: "nope" } : okPhoto();
    });
    renderBoard();
    chooseFiles(["ok1.png", "boom.png", "ok2.png"]);

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: hub.album.retryImportTile })).toHaveLength(1),
    );
    expect(uploadPhotoDirect).toHaveBeenCalledTimes(3);
  });

  it("a thrown/rejected per-item action marks the tile failed without crashing the pool", async () => {
    uploadPhotoDirect.mockImplementation(async (...args: unknown[]) => {
      const name = (args[0] as File).name;
      if (name === "throw.png") throw new Error("network");
      return okPhoto();
    });
    renderBoard();
    chooseFiles(["ok1.png", "throw.png", "ok2.png"]);

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: hub.album.retryImportTile })).toHaveLength(1),
    );
    expect(uploadPhotoDirect).toHaveBeenCalledTimes(3);
  });

  it("tapping retry re-invokes the action for just that item and clears the failed state on success", async () => {
    let failFirst = true;
    uploadPhotoDirect.mockImplementation(async (...args: unknown[]) => {
      const name = (args[0] as File).name;
      if (name === "retry.png" && failFirst) {
        failFirst = false;
        return { error: "first time fails" };
      }
      return okPhoto();
    });
    renderBoard();
    chooseFiles(["retry.png"]);

    const retry = await screen.findByRole("button", { name: hub.album.retryImportTile });
    fireEvent.click(retry);

    // Re-invoked → tile clears (success) → no failed/importing tiles remain.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: hub.album.retryImportTile })).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText(hub.album.importingTile)).toBeNull(),
    );
    expect(uploadPhotoDirect).toHaveBeenCalledTimes(2);
  });

  it("never runs more than IMPORT_POOL_CONCURRENCY per-item actions concurrently", async () => {
    const gates = [
      deferred<{ ok: true }>(),
      deferred<{ ok: true }>(),
      deferred<{ ok: true }>(),
      deferred<{ ok: true }>(),
      deferred<{ ok: true }>(),
    ];
    let inFlight = 0;
    let maxInFlight = 0;
    let started = 0;
    uploadPhotoDirect.mockImplementation(async () => {
      const idx = started++;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gates[idx]!.promise;
      inFlight -= 1;
      return okPhoto();
    });

    renderBoard();
    chooseFiles(["1.png", "2.png", "3.png", "4.png", "5.png"]);

    // Pool caps the burst: only IMPORT_POOL_CONCURRENCY start before any settle.
    await waitFor(() => expect(started).toBe(IMPORT_POOL_CONCURRENCY));
    expect(maxInFlight).toBe(IMPORT_POOL_CONCURRENCY);

    // Settle one → the next queued item starts, still capped.
    gates[0]!.resolve({ ok: true });
    await waitFor(() => expect(started).toBe(IMPORT_POOL_CONCURRENCY + 1));
    expect(maxInFlight).toBe(IMPORT_POOL_CONCURRENCY);

    // Drain the rest.
    for (const g of gates) g.resolve({ ok: true });
    await waitFor(() => expect(uploadPhotoDirect).toHaveBeenCalledTimes(5));
  });

  // Regression (review finding): starting a SECOND batch while the first is still draining must
  // ACCUMULATE the run total — not reset it. A reset would let the first run's in-flight successes
  // push `completed` past the new (smaller) total ("3 of 2"), or freeze the counter mid-run.
  it("accumulates 'X of N' when a second batch starts before the first finishes (no reset)", async () => {
    const shared = deferred<void>();
    uploadPhotoDirect.mockImplementation(async () => {
      await shared.promise;
      return okPhoto();
    });
    renderBoard();
    chooseFiles(["a.png", "b.png"]);
    // First run in flight, nothing settled yet → "Adding 0 of 2…".
    await waitFor(() =>
      expect(screen.getByText(hub.album.importProgress(0, 2))).toBeTruthy(),
    );
    // Second batch begins before the first drains → total accumulates to 4, NOT reset to 2.
    chooseFiles(["c.png", "d.png"]);
    await waitFor(() =>
      expect(screen.getByText(hub.album.importProgress(0, 4))).toBeTruthy(),
    );
    // Release everything → all four land and the progress line clears (no impossible fraction).
    shared.resolve();
    await waitFor(() =>
      expect(uploadPhotoDirect).toHaveBeenCalledTimes(4),
    );
    await waitFor(() =>
      expect(screen.queryByText(/adding .* of .*/i)).toBeNull(),
    );
  });

  it("shows a live 'X of N' while importing and reflects completions", async () => {
    const gate = deferred<{ ok: true }>();
    let calls = 0;
    uploadPhotoDirect.mockImplementation(async () => {
      calls += 1;
      // Hold the LAST call open so a progress line is still on screen mid-run.
      if (calls === 2) {
        await gate.promise;
      }
      return okPhoto();
    });
    renderBoard();
    chooseFiles(["a.png", "b.png"]);

    // One landed, one still in flight → "Adding 1 of 2…".
    await waitFor(() =>
      expect(screen.getByText(hub.album.importProgress(1, 2))).toBeTruthy(),
    );
    gate.resolve({ ok: true });
    // All settled → progress line gone.
    await waitFor(() =>
      expect(screen.queryByText(/adding .* of .*/i)).toBeNull(),
    );
  });
});

describe("AlbumBoard Google import (list-first, exact-N)", () => {
  const googleProps = {
    googlePhotosConfigured: true,
    googlePhotosConnected: true,
    googlePhotosEmail: "user@gmail.com",
  };

  function primeStartAndPoll() {
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
    return openSpy;
  }

  it("lists once then imports each item exactly once, passing baseUrl (not a token)", async () => {
    const openSpy = primeStartAndPoll();
    listGooglePhotosImportAction.mockResolvedValueOnce({
      ok: true,
      count: 2,
      items: [
        { id: "g1", mimeType: "image/jpeg", filename: "one.jpg", baseUrl: "https://base/g1" },
        { id: "g2", mimeType: "image/jpeg", filename: null, baseUrl: "https://base/g2" },
      ],
      skipped: 0,
      rejected: 0,
    });

    renderBoard(googleProps);
    clickGoogleImport();

    await waitFor(() =>
      expect(listGooglePhotosImportAction).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(importOneGooglePhotoAction).toHaveBeenCalledTimes(2),
    );
    expect(listGooglePhotosImportAction).toHaveBeenCalledWith("sess-1");

    // The FormData carries the baseUrl handle — and NEVER an access token.
    const fd = importOneGooglePhotoAction.mock.calls[0]![0] as FormData;
    expect(fd.get("baseUrl")).toMatch(/^https:\/\/base\//);
    expect(fd.get("id")).toBeTruthy();
    expect(fd.get("accessToken")).toBeNull();
    expect(fd.get("token")).toBeNull();
    openSpy.mockRestore();
  });

  it("surfaces a list-step { error } and imports nothing", async () => {
    const openSpy = primeStartAndPoll();
    listGooglePhotosImportAction.mockResolvedValueOnce({ error: "list failed" });

    renderBoard(googleProps);
    clickGoogleImport();

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/list failed/i),
    );
    expect(importOneGooglePhotoAction).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("shows a gentle note and imports nothing when count is 0", async () => {
    const openSpy = primeStartAndPoll();
    listGooglePhotosImportAction.mockResolvedValueOnce({
      ok: true,
      count: 0,
      items: [],
      skipped: 1,
      rejected: 0,
    });

    renderBoard(googleProps);
    clickGoogleImport();

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/no photos|videos|nothing/i),
    );
    expect(importOneGooglePhotoAction).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

// Regression (diagnosed bug): uploading N photos, each spinner vanished on success but its photo did
// NOT appear until a coalesced router.refresh() finally landed — so tiles blanked one-by-one, then all
// photos popped at once. Root cause: the tile's REMOVAL (instant local state) was decoupled from its
// APPEARANCE (a slow, coalesced server refetch). The fix returns the created photo id per item and
// renders it optimistically, so each tile swaps straight from spinner to its real photo.
describe("AlbumBoard optimistic tile (regression: no blank gap, no all-at-once)", () => {
  const PHOTO_ALT = hub.album.photoAlt(null);

  it("a completed tile shows its real photo immediately — WITHOUT a server refresh delivering it", async () => {
    // props.photos stays [] the whole time: the photo must appear from the action's returned id, not
    // from a refresh. Before the fix, nothing would render here (the tile was just removed).
    uploadPhotoDirect.mockResolvedValue({ ok: true, photoId: "opt-1" });
    renderBoard({ photos: [] });
    chooseFiles(["a.png"]);

    const img = await screen.findByRole("img", { name: PHOTO_ALT });
    expect(img.getAttribute("src")).toBe("/api/album-photo/opt-1");
    // No spinner and no blank left behind.
    expect(screen.queryByLabelText(hub.album.importingTile)).toBeNull();
    expect(refresh).toHaveBeenCalled(); // refresh still fires — only to reconcile, not to reveal.
  });

  it("finished tiles reveal their photos incrementally while others still import (not all-at-once)", async () => {
    const slow = deferred<{ ok: true; photoId: string }>();
    let fast = 0;
    uploadPhotoDirect.mockImplementation(async (...args: unknown[]) => {
      const name = (args[0] as File).name;
      if (name === "slow.png") return slow.promise;
      return { ok: true, photoId: `fast-${(fast += 1)}` };
    });
    renderBoard({ photos: [] });
    chooseFiles(["f1.png", "f2.png", "slow.png"]);

    // The two fast ones show real photos while the slow one is STILL a spinner — proving per-item
    // reveal, not a single batched pop at the end.
    await waitFor(() =>
      expect(screen.getAllByRole("img", { name: PHOTO_ALT })).toHaveLength(2),
    );
    expect(screen.getByLabelText(hub.album.importingTile)).toBeTruthy();

    slow.resolve({ ok: true, photoId: "slow-1" });
    await waitFor(() =>
      expect(screen.getAllByRole("img", { name: PHOTO_ALT })).toHaveLength(3),
    );
  });

  it("drops the optimistic placeholder once a refresh delivers the same photo (no duplicate tile)", async () => {
    uploadPhotoDirect.mockResolvedValue({ ok: true, photoId: "dup-1" });
    const view = render(
      <AlbumBoard
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[FAM_A.familyId]}
        viewedFamilyIds={[FAM_A.familyId]}
        uploaderScope="all"
        showFileUpload
        googlePhotosConfigured={false}
        googlePhotosConnected={false}
        googlePhotosEmail={null}
        googlePhotosOauthConnected={false}
        googlePhotosOauthError={null}
        photos={[]}
      />,
    );
    chooseFiles(["a.png"]);
    await screen.findByRole("img", { name: PHOTO_ALT });

    // The server refresh now returns the real row (same id). The board must reconcile: the real grid
    // tile takes over and the optimistic placeholder is dropped — exactly ONE tile for dup-1.
    view.rerender(
      <AlbumBoard
        families={[FAM_A]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[FAM_A.familyId]}
        viewedFamilyIds={[FAM_A.familyId]}
        uploaderScope="all"
        showFileUpload
        googlePhotosConfigured={false}
        googlePhotosConnected={false}
        googlePhotosEmail={null}
        googlePhotosOauthConnected={false}
        googlePhotosOauthError={null}
        photos={[{ id: "dup-1", caption: null, canManage: true }]}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByRole("img", { name: PHOTO_ALT })).toHaveLength(1),
    );
  });

  // Regression (review finding): an optimistic `loaded` tile is only reconciled when its photo shows
  // up in a refreshed `props.photos`. If the contributor uploads to a family OUTSIDE the currently
  // viewed scope, that photo NEVER enters this grid — so an unconditional optimistic tile would be
  // stuck forever. The board must drop it (pre-optimistic behavior) for an out-of-scope target.
  it("does NOT leave a stuck tile when the upload targets a family outside the viewed scope", async () => {
    uploadPhotoDirect.mockResolvedValue({ ok: true, photoId: "out-of-scope-1" });
    // Viewing Family A only; the multi-family picker is shown (2 families) seeded to A.
    render(
      <AlbumBoard
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[FAM_A.familyId]}
        viewedFamilyIds={[FAM_A.familyId]}
        uploaderScope={FAM_A.familyId}
        showFileUpload
        googlePhotosConfigured={false}
        googlePhotosConnected={false}
        googlePhotosEmail={null}
        googlePhotosOauthConnected={false}
        googlePhotosOauthError={null}
        photos={[]}
      />,
    );
    // Retarget: deselect A, select B — the photo will land ONLY in B, never in this A-scoped grid.
    fireEvent.click(screen.getByRole("button", { name: FAM_A.familyName }));
    fireEvent.click(screen.getByRole("button", { name: FAM_B.familyName }));
    chooseFiles(["x.png"]);

    await waitFor(() => expect(uploadPhotoDirect).toHaveBeenCalledTimes(1));
    // The tile is dropped on success — no stuck optimistic photo, no lingering spinner.
    await waitFor(() =>
      expect(screen.queryByLabelText(hub.album.importingTile)).toBeNull(),
    );
    expect(screen.queryByRole("img", { name: PHOTO_ALT })).toBeNull();
    // Sanity: the action really did receive ONLY the out-of-scope family id.
    expect(uploadPhotoDirect.mock.calls[0]![1]).toEqual([FAM_B.familyId]);
  });

  // ADR-0021 (review finding — coverage gap): the board is the F2 mount point the ADR names
  // explicitly, so assert the "ambiguous ⇒ deliberate pick" contract AT the board boundary, not just
  // inside AlbumUploader. With >1 family and an EMPTY designator default (the ambiguous all/none case),
  // the "Add to album" button must be disabled until the contributor picks — a photo never silently
  // fans out to every family through the board path.
  it("ambiguous (empty defaultSelected, >1 family): Add is disabled until a deliberate pick", async () => {
    render(
      <AlbumBoard
        families={[FAM_A, FAM_B]}
        currentFamilyId={FAM_A.familyId}
        defaultSelected={[]}
        viewedFamilyIds={[FAM_A.familyId, FAM_B.familyId]}
        uploaderScope="all"
        showFileUpload
        googlePhotosConfigured={false}
        googlePhotosConnected={false}
        googlePhotosEmail={null}
        googlePhotosOauthConnected={false}
        googlePhotosOauthError={null}
        photos={[]}
      />,
    );
    // Nothing pre-selected → the device-add menuitem (#93, inside the Add Photos menu) is disabled
    // (no default fan-out). Re-query it after each render since the menu re-renders on selection.
    const deviceItem = () =>
      screen.getByRole("menuitem", { name: hub.album.addFromDevice }) as HTMLButtonElement;
    openAddMenu();
    expect(deviceItem().disabled).toBe(true);

    // A deliberate pick of ONE family enables it, and an upload targets ONLY that family. Clicking a
    // chip (a click, not a pointerdown) leaves the menu open.
    fireEvent.click(screen.getByRole("button", { name: FAM_B.familyName }));
    expect(deviceItem().disabled).toBe(false);
    chooseFiles(["deliberate.png"]);

    await waitFor(() => expect(uploadPhotoDirect).toHaveBeenCalledTimes(1));
    expect(uploadPhotoDirect.mock.calls[0]![1]).toEqual([FAM_B.familyId]);
  });
});
