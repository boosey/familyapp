// @vitest-environment jsdom
/**
 * AskPhotoPicker — the OPTIONAL photo picker inside the Ask form (ADR-0009 Phase 3).
 *
 * The load-and-render/toggle behaviour is exercised here alongside the NEW deep-link seed:
 * `?subjectPhotoIds=<id>` (threaded from /hub?tab=ask through AskTab as `initialSelectedPhotoIds`)
 * pre-selects those photos on mount.
 *  1. A preselected id that IS among the asker's loaded album options renders pre-selected:
 *     aria-pressed=true AND a hidden `subjectPhotoIds` input carrying that id rides the form.
 *  2. A preselected id that is NOT among the loaded options is dropped silently — no phantom
 *     selection, no throw, no stray hidden input.
 *  3. With no seed, nothing is preselected (regression guard on the default path).
 *
 * `loadAskPhotoOptionsAction` is a "use server" module (pulls db/auth at import) so it is mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AskPhotoPicker deep-link preselection", () => {
  it("pre-selects a photo whose id is passed via initialSelectedPhotoIds", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(<AskPhotoPicker initialSelectedPhotoIds={["photo-1"]} />);

    // The toggle button for photo-1 becomes pressed once options load.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /remove/i, pressed: true }),
      ).toBeTruthy();
    });
    // ...and its id rides the ask form as a hidden input; the un-seeded photo-2 does not.
    expect(hiddenSubjectIds()).toEqual(["photo-1"]);
    // photo-2 stays un-pressed (attachable).
    const buttons = screen.getAllByRole("button");
    const pressed = buttons.filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });

  it("drops a preselected id that is not among the loaded options (no phantom, no throw)", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(
      <AskPhotoPicker initialSelectedPhotoIds={["photo-1", "does-not-exist"]} />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    });
    // Only the real, visible id is selected; the phantom is silently dropped.
    expect(hiddenSubjectIds()).toEqual(["photo-1"]);
  });

  it("preselects nothing when no seed is provided", async () => {
    loadAskPhotoOptionsAction.mockResolvedValue(ALBUM);
    render(<AskPhotoPicker />);

    await waitFor(() => {
      expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    });
    expect(hiddenSubjectIds()).toEqual([]);
  });
});
