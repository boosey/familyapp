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
    // closed form shows the selection readout — all without opening the modal. The seed is applied in
    // the load effect's microtask (which resolves AFTER the "Add photos" button first renders, since
    // the button is present pre-load), so wait for the settled selection rather than asserting eagerly.
    await waitFor(() => expect(hiddenSubjectIds()).toEqual(["photo-1"]));
    expect(screen.getByText("1 photo selected")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drops a preselected id that is not among the loaded options (no phantom, no throw)", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(
      <AskPhotoPicker initialSelectedPhotoIds={["photo-1", "does-not-exist"]} />,
    );
    await waitForLoad();

    // Only the real, visible id is selected; the phantom is silently dropped. Wait for the seed to
    // settle (see the load-microtask note above) — the button renders pre-load, so waitForLoad alone
    // does not guarantee the selection has been applied.
    await waitFor(() => expect(hiddenSubjectIds()).toEqual(["photo-1"]));
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

  it("closes on Escape", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(<AskPhotoPicker />);
    await waitForLoad();

    fireEvent.click(screen.getByRole("button", { name: "Add photos" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a backdrop click (but not on a click inside the dialog)", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(<AskPhotoPicker />);
    await waitForLoad();

    fireEvent.click(screen.getByRole("button", { name: "Add photos" }));
    // A click bubbling up from INSIDE the dialog must not close it.
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Clicking the backdrop itself (target === currentTarget) closes.
    fireEvent.click(screen.getByTestId("ask-photo-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus into the dialog on open and restores it to the 'Add photos' trigger on close", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(<AskPhotoPicker />);
    await waitForLoad();

    const trigger = screen.getByRole("button", { name: "Add photos" });
    trigger.focus();
    fireEvent.click(trigger);

    // Focus moved into the dialog on open...
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);

    // ...and returns to the trigger when the modal closes.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab inside the dialog (last focusable wraps to the first)", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(<AskPhotoPicker />);
    await waitForLoad();

    fireEvent.click(screen.getByRole("button", { name: "Add photos" }));
    const dialog = screen.getByRole("dialog");
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>("button:not([disabled])"),
    );
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    expect(last).toBe(screen.getByRole("button", { name: "Done" }));

    // Tabbing past the last focusable wraps back to the first instead of escaping the modal.
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("surfaces a load error inline on the closed form (no modal click needed)", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue({
      error: "Couldn't load your album photos. You can still send the question.",
    });
    render(<AskPhotoPicker />);

    // The error is visible without opening the modal — and repeated inside the modal too.
    await waitFor(() => {
      expect(screen.getByText(/couldn't load your album photos/i)).toBeTruthy();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
