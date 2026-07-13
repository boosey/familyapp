// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

const { editStoryDetailsAction, tagStorySubjectAction, untagStorySubjectAction, retargetStoryFamiliesAction } =
  vi.hoisted(() => ({
    editStoryDetailsAction: vi.fn(async (_fd: FormData) => undefined),
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

it("removing a family chip confirms, then posts the reduced family set and touches nothing else", async () => {
  render(
    <StoryEditor
      storyId="S"
      initialTitle="My Story"
      initialTags={[]}
      initialProse="Once upon a time."
      initialPersonSubjects={[]}
      initialTargetFamilies={[{ id: "f1", name: "Fam One" }, { id: "f2", name: "Fam Two" }]}
      suggestions={suggestions}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(document.querySelector('[aria-label="Remove Fam One"]')!);

  expect(confirm).toHaveBeenCalled();
  await waitFor(() => expect(retargetStoryFamiliesAction).toHaveBeenCalledTimes(1));
  const fd = retargetStoryFamiliesAction.mock.calls[0]![0] as FormData;
  expect(fd.getAll("familyIds")).toEqual(["f2"]);
  expect(untagStorySubjectAction).not.toHaveBeenCalled();
  expect(editStoryDetailsAction).not.toHaveBeenCalled();
});
