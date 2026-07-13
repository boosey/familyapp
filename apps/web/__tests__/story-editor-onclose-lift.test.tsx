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

import { StoryEditor } from "@/app/hub/stories/[id]/StoryEditor";
import type { TagSuggestions } from "@/app/hub/tag-input-types";

const suggestions: TagSuggestions = { people: [], families: [], tags: [] };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("calls onClose with the current edited values (title/tags/prose/targetFamilies) when Done is clicked", async () => {
  const onClose = vi.fn();

  render(
    <StoryEditor
      storyId="S"
      initialTitle="Old"
      initialTags={["a"]}
      initialProse="Once upon a time."
      initialPersonSubjects={[]}
      initialTargetFamilies={[{ id: "f1", name: "Smiths" }]}
      suggestions={suggestions}
      onClose={onClose}
    />,
  );

  const titleInput = document.querySelector('input[type="text"]') as HTMLInputElement;
  fireEvent.change(titleInput, { target: { value: "New Title" } });

  // Click the "Done" button specifically by its text.
  const doneButton = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === "Done",
  ) as HTMLButtonElement;
  fireEvent.click(doneButton);

  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  const arg = onClose.mock.calls[0]![0];
  expect(arg.title).toBe("New Title");
  expect(arg.tags).toEqual(["a"]);
  expect(arg.prose).toBe("Once upon a time.");
  expect(arg.targetFamilies).toEqual([{ id: "f1", name: "Smiths" }]);
});
