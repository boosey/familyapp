// @vitest-environment jsdom
/**
 * AskPhotoPicker (#204) — the OPTIONAL photo picker of the Ask form (ADR-0009 Phase 3), now an
 * "Add photos" button that opens a MODAL album picker instead of an inline grid.
 *
 * Pinned here:
 *  1. Deep-link seed: `?subjectPhotoIds=<id>` (threaded from /hub?tab=ask through AskTab as
 *     `initialSelectedPhotoIds`) pre-selects those photos — the hidden `subjectPhotoIds` input and
 *     the closed-form selection readout appear WITHOUT opening the modal.
 *  2. A preselected id that is NOT among the loaded options is dropped silently — no phantom
 *     selection, no throw, no stray hidden input.
 *  3. With no seed, nothing is preselected (regression guard on the default path).
 *  4. The toggle grid lives in the modal: closed there is no dialog; "Add photos" opens it;
 *     toggling a photo emits its hidden input; "Done" closes and the count readout updates.
 *
 * `loadAskPhotoOptionsAction` is a "use server" module (pulls db/auth at import) so it is mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AskPhotoPicker } from "@/app/hub/tabs/AskPhotoPicker";
import type { AskPhotoOptions } from "@/app/hub/tabs/ask-photo-actions";

const loadAskPhotoOptionsAction = vi.fn<() => Promise<AskPhotoOptions>>();
vi.mock("@/app/hub/tabs/ask-photo-actions", () => ({
  loadAskPhotoOptionsAction: () => loadAskPhotoOptionsAction(),
}));

const ALBUM: AskPhotoOptions = {
  ok: true,
  album: [
    { photoId: "photo-1", caption: "At the shore" },
    { photoId: "photo-2", caption: null },
  ],
};

/** Collect the hidden `subjectPhotoIds` values currently in the form. */
function hiddenSubjectIds(): string[] {
  return Array.from(
    document.querySelectorAll('input[type="hidden"][name="subjectPhotoIds"]'),
  ).map((el) => (el as HTMLInputElement).value);
}

/** Wait for the album load to settle (the "Add photos" button renders once options exist). */
async function waitForLoad() {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Add photos" })).toBeTruthy();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AskPhotoPicker deep-link preselection", () => {
  it("pre-selects a photo whose id is passed via initialSelectedPhotoIds", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(<AskPhotoPicker initialSelectedPhotoIds={["photo-1"]} />);
    await waitForLoad();

    // The seeded id rides the ask form as a hidden input, the un-seeded photo-2 does not, and the
    // closed form shows the selection readout — all without opening the modal.
    expect(hiddenSubjectIds()).toEqual(["photo-1"]);
    expect(screen.getByText("1 photo selected")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drops a preselected id that is not among the loaded options (no phantom, no throw)", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(
      <AskPhotoPicker initialSelectedPhotoIds={["photo-1", "does-not-exist"]} />,
    );
    await waitForLoad();

    // Only the real, visible id is selected; the phantom is silently dropped.
    expect(hiddenSubjectIds()).toEqual(["photo-1"]);
  });

  it("preselects nothing when no seed is provided", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(<AskPhotoPicker />);
    await waitForLoad();

    expect(hiddenSubjectIds()).toEqual([]);
    expect(screen.queryByText(/photo(s)? selected/)).toBeNull();
  });
});

describe("AskPhotoPicker modal picker", () => {
  it("opens on 'Add photos', toggles photos into hidden inputs, and closes on 'Done'", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(<AskPhotoPicker />);
    await waitForLoad();

    // The grid lives in the modal — no dialog until the button is clicked.
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add photos" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Toggle photo-1 on: pressed + hidden input. photo-2 stays attachable.
    fireEvent.click(screen.getByRole("button", { name: /ask about “at the shore”/i }));
    expect(screen.getByRole("button", { name: /remove/i, pressed: true })).toBeTruthy();
    expect(hiddenSubjectIds()).toEqual(["photo-1"]);

    // Done closes the modal; the selection readout stays on the closed form.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(hiddenSubjectIds()).toEqual(["photo-1"]);
    expect(screen.getByText("1 photo selected")).toBeTruthy();
  });
});
