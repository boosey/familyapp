// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

const { editStoryDetailsAction, tagStorySubjectAction, untagStorySubjectAction, retargetStoryFamiliesAction } =
  vi.hoisted(() => ({
    editStoryDetailsAction: vi.fn(async (_fd: FormData) => undefined),
    tagStorySubjectAction: vi.fn(async (_fd: FormData) => ({ personId: "person-real" })),
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

it("adding a new person threads the real minted personId back so a same-session remove posts the real id, not the placeholder", async () => {
  render(
    <StoryEditor
      storyId="S"
      initialTitle="My Story"
      initialTags={[]}
      initialProse="Once upon a time."
      initialPersonSubjects={[]}
      initialTargetFamilies={[]}
      suggestions={suggestions}
      onClose={vi.fn()}
    />,
  );

  const input = document.querySelector('input[placeholder]') as HTMLInputElement;
  expect(input.placeholder).toMatch(/add a tag or name/i);

  fireEvent.change(input, { target: { value: "Grandma Rose" } });

  const addAsPersonOption = await waitFor(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const match = buttons.find((b) => /Grandma Rose/.test(b.textContent ?? "") && /person/i.test(b.textContent ?? ""));
    expect(match).toBeTruthy();
    return match!;
  });
  fireEvent.click(addAsPersonOption);

  await waitFor(() => expect(tagStorySubjectAction).toHaveBeenCalledTimes(1));
  const addFd = tagStorySubjectAction.mock.calls[0]![0] as FormData;
  expect(addFd.get("newPersonDisplayName")).toBe("Grandma Rose");

  // Wait for the optimistic placeholder to be replaced with the real minted id.
  const removeButton = await waitFor(() => {
    const btn = document.querySelector('[aria-label="Remove Grandma Rose"]');
    expect(btn).toBeTruthy();
    return btn as HTMLButtonElement;
  });

  fireEvent.click(removeButton);

  await waitFor(() => expect(untagStorySubjectAction).toHaveBeenCalledTimes(1));
  const removeFd = untagStorySubjectAction.mock.calls[0]![0] as FormData;
  expect(removeFd.get("personId")).toBe("person-real");
  expect(removeFd.get("personId")).not.toMatch(/^pending:/);
});
