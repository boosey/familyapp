// @vitest-environment jsdom
/**
 * Regression (edit-story spec, item 4): a story shared with EXACTLY ONE family must not let that last
 * family be removed from the consolidated editor — dropping it would silently un-share the story. The
 * family chip renders WITHOUT a remove (✕) button in that case; with two or more families every chip
 * stays removable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../app/hub/stories/[id]/actions", () => ({
  editStoryDetailsAction: vi.fn(async () => undefined),
  tagStorySubjectAction: vi.fn(async () => undefined),
  untagStorySubjectAction: vi.fn(async () => undefined),
  retargetStoryFamiliesAction: vi.fn(async () => undefined),
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

function renderEditor(families: { id: string; name: string }[]) {
  render(
    <StoryEditor
      storyId="S"
      initialTitle="My Story"
      initialTags={[]}
      initialProse="Once."
      initialPersonSubjects={[]}
      initialTargetFamilies={families}
      suggestions={suggestions}
      onClose={vi.fn()}
    />,
  );
}

describe("StoryEditor — last family chip is not removable", () => {
  it("hides the remove (✕) button when the story targets exactly one family", () => {
    renderEditor([{ id: "f1", name: "Fam One" }]);
    // The chip itself is shown…
    expect(screen.getByText("Fam One")).toBeTruthy();
    // …but its remove control is absent.
    expect(screen.queryByLabelText("Remove Fam One")).toBeNull();
  });

  it("keeps every family removable when the story targets two or more families", () => {
    renderEditor([
      { id: "f1", name: "Fam One" },
      { id: "f2", name: "Fam Two" },
    ]);
    expect(screen.getByLabelText("Remove Fam One")).toBeTruthy();
    expect(screen.getByLabelText("Remove Fam Two")).toBeTruthy();
  });
});
