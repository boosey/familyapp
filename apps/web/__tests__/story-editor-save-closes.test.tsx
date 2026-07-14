// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

const { editStoryDetailsAction, editStoryProseAction, tagStorySubjectAction, untagStorySubjectAction, retargetStoryFamiliesAction } =
  vi.hoisted(() => ({
    editStoryDetailsAction: vi.fn(async (_fd: FormData) => undefined as { error?: string } | undefined),
    editStoryProseAction: vi.fn(async (_fd: FormData) => undefined as { error?: string } | undefined),
    tagStorySubjectAction: vi.fn(async (_fd: FormData) => undefined),
    untagStorySubjectAction: vi.fn(async (_fd: FormData) => undefined),
    retargetStoryFamiliesAction: vi.fn(async (_fd: FormData) => undefined),
  }));
vi.mock("../app/hub/stories/[id]/actions", () => ({
  editStoryDetailsAction,
  editStoryProseAction,
  tagStorySubjectAction,
  untagStorySubjectAction,
  retargetStoryFamiliesAction,
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

it("closes the editor (via onClose with the edited values) after a successful Save", async () => {
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

  const saveButton = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === "Save",
  ) as HTMLButtonElement;
  fireEvent.click(saveButton);

  await waitFor(() => expect(editStoryProseAction).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  const arg = onClose.mock.calls[0]![0];
  expect(arg.title).toBe("New Title");
  expect(arg.tags).toEqual(["a"]);
  expect(arg.prose).toBe("Once upon a time.");
  expect(arg.targetFamilies).toEqual([{ id: "f1", name: "Smiths" }]);
});

it("keeps the editor open (no onClose) when the Save fails", async () => {
  editStoryDetailsAction.mockResolvedValueOnce({ error: "nope" });
  const onClose = vi.fn();

  render(
    <StoryEditor
      storyId="S"
      initialTitle="Old"
      initialTags={[]}
      initialProse="Once upon a time."
      initialPersonSubjects={[]}
      initialTargetFamilies={[]}
      suggestions={suggestions}
      onClose={onClose}
    />,
  );

  const saveButton = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === "Save",
  ) as HTMLButtonElement;
  fireEvent.click(saveButton);

  await waitFor(() => expect(editStoryDetailsAction).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(document.body.textContent).toContain("nope"));
  expect(onClose).not.toHaveBeenCalled();
  // The prose action never fires once details rejects.
  expect(editStoryProseAction).not.toHaveBeenCalled();
});

it("does not close and does not save when the title is empty", async () => {
  const onClose = vi.fn();

  render(
    <StoryEditor
      storyId="S"
      initialTitle="   "
      initialTags={[]}
      initialProse="Once upon a time."
      initialPersonSubjects={[]}
      initialTargetFamilies={[]}
      suggestions={suggestions}
      onClose={onClose}
    />,
  );

  const saveButton = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === "Save",
  ) as HTMLButtonElement;
  fireEvent.click(saveButton);

  await waitFor(() => expect(document.body.textContent).toContain("Title can't be empty."));
  expect(editStoryDetailsAction).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
