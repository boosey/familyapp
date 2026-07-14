// @vitest-environment jsdom
/**
 * Regression (edit-story spec, items 2 · 3 · 5): the story photo editor no longer shows an always-on
 * inline album grid. Instead it offers two buttons — "Add from album" (opens a modal that BOTH picks
 * an existing album photo and uploads from device) and "Add from Google" (import + auto-attach). The
 * attached photos carry a compact icon toolstrip (make cover · move up · move down · delete).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { hub } from "@/app/_copy";

const loadStoryPhotoEditorAction = vi.fn(async () => ({
  ok: true as const,
  attached: [
    { storyImageId: "si1", familyPhotoId: "fp1", caption: null, isCover: true, position: 0 },
  ],
  album: [{ photoId: "alb1", caption: "Beach" }],
  nudge: null,
  families: [{ id: "f1", name: "Fam" }],
  googleConfigured: true,
  googleConnected: true,
  googleEmail: "a@b.com",
}));
const attachStoryPhotoAction = vi.fn(async (_fd: FormData) => ({ ok: true as const }));

vi.mock("@/app/hub/answer/[askId]/photo-actions", () => ({
  loadStoryPhotoEditorAction: () => loadStoryPhotoEditorAction(),
  attachStoryPhotoAction: (fd: FormData) => attachStoryPhotoAction(fd),
  detachStoryPhotoAction: vi.fn(async () => ({ ok: true })),
  setStoryCoverAction: vi.fn(async () => ({ ok: true })),
  reorderStoryPhotosAction: vi.fn(async () => ({ ok: true })),
}));

import { StoryPhotosEditor } from "@/app/hub/StoryPhotosEditor";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderLoaded() {
  render(<StoryPhotosEditor storyId="story-1" />);
  // Wait for the loader to settle so the add buttons (gated on families) render.
  await screen.findByRole("button", { name: hub.storyImages.addFromAlbumButton });
}

describe("StoryPhotosEditor — add controls & toolstrip", () => {
  it("shows the two add buttons and NO inline album grid until the modal is opened", async () => {
    await renderLoaded();
    expect(screen.getByRole("button", { name: hub.storyImages.addFromAlbumButton })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.storyImages.addFromGoogleButton })).toBeTruthy();
    // The album photo's attach control lives only inside the modal now — absent before opening.
    expect(screen.queryByRole("button", { name: hub.storyImages.attachAria("Beach") })).toBeNull();
  });

  it("opens a modal exposing the existing-album picker AND device upload", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: hub.storyImages.addFromAlbumButton }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    // Existing-album picker photo is now reachable…
    const attachBtn = screen.getByRole("button", { name: hub.storyImages.attachAria("Beach") });
    // …and the device-upload affordance is present.
    expect(screen.getByRole("button", { name: hub.storyImages.uploadFromDevice })).toBeTruthy();
    // Tapping an album photo attaches it via the shared attach action.
    fireEvent.click(attachBtn);
    await waitFor(() => expect(attachStoryPhotoAction).toHaveBeenCalledTimes(1));
    expect(attachStoryPhotoAction.mock.calls[0]![0].get("familyPhotoId")).toBe("alb1");
  });

  it("renders a compact icon toolstrip on each attached photo", async () => {
    await renderLoaded();
    expect(screen.getByRole("button", { name: hub.storyImages.setCover })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.storyImages.moveUp })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.storyImages.moveDown })).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.storyImages.remove })).toBeTruthy();
    // The cover image's "make cover" button is disabled (it is already the cover).
    expect(
      (screen.getByRole("button", { name: hub.storyImages.setCover }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
