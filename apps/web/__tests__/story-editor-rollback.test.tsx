// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

const { editStoryDetailsAction, tagStorySubjectAction, untagStorySubjectAction, retargetStoryFamiliesAction } =
  vi.hoisted(() => ({
    editStoryDetailsAction: vi.fn(async (_fd: FormData) => undefined as { error?: string } | undefined),
    tagStorySubjectAction: vi.fn(async (_fd: FormData) => undefined),
    untagStorySubjectAction: vi.fn(async (_fd: FormData) => undefined),
    retargetStoryFamiliesAction: vi.fn(async (_fd: FormData) => undefined),
  }));
vi.mock("../app/hub/stories/[id]/actions", () => ({
  editStoryDetailsAction,
  tagStorySubjectAction,
  untagStorySubjectAction,
  retargetStoryFamiliesAction,
  editStoryProseAction: vi.fn(async () => undefined),
}));
// StoryPhotosEditor self-loads; stub it so this stays a pure editor test.
vi.mock("../app/hub/StoryPhotosEditor", () => ({ StoryPhotosEditor: () => null }));
// jsdom has no window.confirm by default; make it deterministic.
vi.stubGlobal("confirm", vi.fn(() => true));

import { StoryEditor } from "@/app/hub/stories/[id]/StoryEditor";
import type { TagSuggestions } from "@/app/hub/tag-input-types";

const suggestions: TagSuggestions = { people: [], families: [], tags: [] };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("rolls back an optimistic tag removal when the server rejects the save", async () => {
  editStoryDetailsAction.mockResolvedValueOnce({ error: "nope" });

  render(
    <StoryEditor
      storyId="S"
      initialTitle="My Story"
      initialTags={["Vacation"]}
      initialProse="Once upon a time."
      initialPersonSubjects={[]}
      initialTargetFamilies={[]}
      suggestions={suggestions}
      onClose={vi.fn()}
    />,
  );

  expect(document.querySelector('[aria-label="Remove Vacation"]')).toBeTruthy();

  fireEvent.click(document.querySelector('[aria-label="Remove Vacation"]')!);

  await waitFor(() => expect(editStoryDetailsAction).toHaveBeenCalledTimes(1));

  // The chip must be restored — the optimistic removal is rolled back.
  await waitFor(() => expect(document.querySelector('[aria-label="Remove Vacation"]')).toBeTruthy());
  await waitFor(() => expect(document.body.textContent).toContain("nope"));
});

it("decouples tag autosave from the live (possibly cleared) title, sending the last saved title instead", async () => {
  editStoryDetailsAction.mockResolvedValueOnce(undefined);

  render(
    <StoryEditor
      storyId="S"
      initialTitle="My Title"
      initialTags={[]}
      initialProse="Once upon a time."
      initialPersonSubjects={[]}
      initialTargetFamilies={[]}
      suggestions={suggestions}
      onClose={vi.fn()}
    />,
  );

  const titleInput = document.querySelector('input[type="text"]') as HTMLInputElement;
  expect(titleInput.value).toBe("My Title");
  fireEvent.change(titleInput, { target: { value: "" } });

  const tagInput = document.querySelector('input[placeholder]') as HTMLInputElement;
  fireEvent.change(tagInput, { target: { value: "NewTag" } });
  fireEvent.keyDown(tagInput, { key: "Enter" });

  await waitFor(() => expect(editStoryDetailsAction).toHaveBeenCalledTimes(1));
  const fd = editStoryDetailsAction.mock.calls[0]![0] as FormData;
  expect(fd.get("title")).toBe("My Title");
  expect(fd.get("tags")).toBe("NewTag");
});
