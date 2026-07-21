// @vitest-environment jsdom
/**
 * Regression (edit-story spec, item 1): the reaction buttons (favorite + like) do not belong on the
 * edit surface. When the owner opens the consolidated editor, the reactions row is hidden — and so is
 * the read-only photo strip, which the editor's own photo controls replace while editing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { StoryDetailClient, type StoryDetailClientProps } from "@/app/hub/stories/[id]/StoryDetailClient";

vi.mock("@/app/hub/stories/[id]/actions", () => ({
  editStoryDetailsAction: vi.fn(),
  retargetStoryFamiliesAction: vi.fn(),
  editStoryProseAction: vi.fn(),
  tagStorySubjectAction: vi.fn(),
  untagStorySubjectAction: vi.fn(),
}));
vi.mock("@/app/hub/stories/[id]/FavoriteButton", () => ({
  FavoriteButton: () => <div data-testid="favorite" />,
}));
vi.mock("@/app/hub/stories/[id]/LikeButton", () => ({
  LikeButton: () => <div data-testid="like" />,
}));
vi.mock("@/app/hub/stories/[id]/FollowUpButton", () => ({ FollowUpButton: () => null }));
// Expose the "edit story" entry point without the real menu chrome.
vi.mock("@/app/hub/stories/[id]/OwnerActionMenu", () => ({
  OwnerActionMenu: ({ onEditStory }: { onEditStory: () => void }) => (
    <button onClick={onEditStory}>edit-story</button>
  ),
}));
// The editor self-loads; stub it to an inert marker.
vi.mock("@/app/hub/stories/[id]/StoryEditor", () => ({
  StoryEditor: () => <div data-testid="editor" />,
}));
vi.mock("@/app/hub/stories/[id]/StoryDateEditor", () => ({ StoryDateEditor: () => null }));

afterEach(() => cleanup());

function makeProps(over: Partial<StoryDetailClientProps> = {}): StoryDetailClientProps {
  return {
    storyId: "story-1",
    isOwner: true,
    narratorPersonId: "narrator-1",
    canAskFollowUp: false,
    initialTitle: "A Sunday",
    initialTags: [],
    initialProse: "PROSE",
    initialTranscript: null,
    initialSummary: null,
    audienceTier: "family",
    updatedAt: "2026-01-01T00:00:00.000Z",
    narratorName: "Eleanor",
    eraLabelStr: "1995",
    storyDate: null,
    storyDateProvenance: null,
    recordingMediaId: null,
    viewerFamilies: [],
    initialTargetFamilies: [],
    favoriteState: { favoritedByViewer: false, count: 0 },
    likeState: { likedByViewer: false, count: 0, likers: [] },
    canReact: true,
    backHref: "/hub?tab=stories",
    storyImages: [{ id: "i1", familyPhotoId: "p1", caption: null }],
    initialPersonSubjects: [],
    tagSuggestions: { people: [], families: [], tags: [] },
    ...over,
  };
}

describe("StoryDetailClient — reactions hidden while editing", () => {
  it("shows reactions + photo row in read view, hides both once the editor opens", () => {
    render(<StoryDetailClient {...makeProps()} />);

    // Read view: reactions and the read-only photo row are present.
    expect(screen.getByTestId("favorite")).toBeTruthy();
    expect(screen.getByTestId("like")).toBeTruthy();
    expect(screen.getByTestId("story-photo-row")).toBeTruthy();

    // Open the consolidated editor.
    fireEvent.click(screen.getByText("edit-story"));

    // Edit view: editor is up; reactions and the read-only row are gone.
    expect(screen.getByTestId("editor")).toBeTruthy();
    expect(screen.queryByTestId("favorite")).toBeNull();
    expect(screen.queryByTestId("like")).toBeNull();
    expect(screen.queryByTestId("story-photo-row")).toBeNull();
  });
});
