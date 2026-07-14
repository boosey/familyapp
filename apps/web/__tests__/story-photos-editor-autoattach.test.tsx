// @vitest-environment jsdom
/**
 * Phase C bulk "tell one story about these N photos": when the composer opens a bulk telling, the
 * non-cover selected photos are handed to StoryPhotosEditor as `autoAttachPhotoIds`, and the editor
 * attaches each ONCE on mount via the SAME `attachStoryPhotoAction` the manual picker uses.
 *
 * Cover dedup: the cover photo is attached to the story at creation, so it is already in the editor's
 * loaded `attached` set. The auto-attach must skip it (no double-attach) and post ONLY the non-cover
 * extras. We assert the exact set of familyPhotoIds posted.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";
const COVER = "photo-cover";

// The editor loads its state from loadStoryPhotoEditorAction, then attaches via attachStoryPhotoAction.
// Mock both. The loaded `attached` contains the COVER (attached at story creation) so the dedup path
// is exercised.
const loadStoryPhotoEditorAction = vi.fn(async (..._a: unknown[]) => ({
  ok: true as const,
  attached: [
    {
      storyImageId: "si-cover",
      familyPhotoId: COVER,
      caption: null,
      isCover: true,
      position: 0,
    },
  ],
  album: [] as { photoId: string; caption: string | null }[],
  nudge: null,
  families: [] as { id: string; name: string }[],
  googleConfigured: false,
  googleConnected: false,
  googleEmail: null,
}));
const attachStoryPhotoAction = vi.fn(async (_fd: FormData) => ({ ok: true as const }));

vi.mock("@/app/hub/answer/[askId]/photo-actions", () => ({
  loadStoryPhotoEditorAction: (...a: unknown[]) => loadStoryPhotoEditorAction(...a),
  attachStoryPhotoAction: (fd: FormData) => attachStoryPhotoAction(fd),
  detachStoryPhotoAction: vi.fn(),
  setStoryCoverAction: vi.fn(),
  reorderStoryPhotosAction: vi.fn(),
}));

import { StoryPhotosEditor } from "@/app/hub/StoryPhotosEditor";

function attachedIds(): string[] {
  return attachStoryPhotoAction.mock.calls.map((c) => (c[0] as FormData).get("familyPhotoId") as string);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StoryPhotosEditor auto-attach (Phase C bulk telling)", () => {
  it("attaches the non-cover extras and SKIPS the already-attached cover", async () => {
    render(
      <StoryPhotosEditor
        storyId={STORY_ID}
        autoAttachPhotoIds={[COVER, "photo-2", "photo-3"]}
      />,
    );

    // photo-2 and photo-3 get attached; the cover (already attached) does not.
    await waitFor(() => expect(attachStoryPhotoAction).toHaveBeenCalledTimes(2));
    expect(new Set(attachedIds())).toEqual(new Set(["photo-2", "photo-3"]));
    expect(attachedIds()).not.toContain(COVER);

    // Every attach posts the right storyId.
    for (const call of attachStoryPhotoAction.mock.calls) {
      expect((call[0] as FormData).get("storyId")).toBe(STORY_ID);
    }
  });

  it("de-dups a repeated extra id (posts it once)", async () => {
    render(
      <StoryPhotosEditor storyId={STORY_ID} autoAttachPhotoIds={["photo-2", "photo-2"]} />,
    );
    await waitFor(() => expect(attachStoryPhotoAction).toHaveBeenCalledTimes(1));
    expect(attachedIds()).toEqual(["photo-2"]);
  });

  it("attaches nothing when there are no extras (ordinary single-photo / plain telling)", async () => {
    render(<StoryPhotosEditor storyId={STORY_ID} autoAttachPhotoIds={[]} />);
    // Let the load settle so we'd have seen any stray attach.
    await waitFor(() => expect(loadStoryPhotoEditorAction).toHaveBeenCalled());
    expect(attachStoryPhotoAction).not.toHaveBeenCalled();
  });

  it("attaches nothing when the only selected photo is the cover (all deduped away)", async () => {
    render(<StoryPhotosEditor storyId={STORY_ID} autoAttachPhotoIds={[COVER]} />);
    await waitFor(() => expect(loadStoryPhotoEditorAction).toHaveBeenCalled());
    expect(attachStoryPhotoAction).not.toHaveBeenCalled();
  });
});
