// @vitest-environment jsdom
/**
 * Task 9 — "View in family tree" affordance on the story-detail surface.
 *
 * When StoryDetailClient receives an `authorTreeHref`, it renders a small link next to the
 * narrator byline (data-testid="story-tree-link") whose href is exactly that value and whose
 * text is the tree-open copy. When the prop is null/undefined, no such link exists.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StoryDetailClient, type StoryDetailClientProps } from "@/app/hub/stories/[id]/StoryDetailClient";
import { hub } from "@/app/_copy";

// Isolate the component from its server actions and heavy child leaves.
vi.mock("@/app/hub/stories/[id]/actions", () => ({
  editStoryDetailsAction: vi.fn(),
  retargetStoryFamiliesAction: vi.fn(),
  editStoryProseAction: vi.fn(),
  tagStorySubjectAction: vi.fn(),
  untagStorySubjectAction: vi.fn(),
}));
vi.mock("@/app/hub/stories/[id]/FavoriteButton", () => ({ FavoriteButton: () => null }));
vi.mock("@/app/hub/stories/[id]/LikeButton", () => ({ LikeButton: () => null }));
vi.mock("@/app/hub/stories/[id]/OwnerActionMenu", () => ({ OwnerActionMenu: () => null }));
vi.mock("@/app/hub/stories/[id]/StoryReadBody", () => ({ StoryReadBody: () => null }));
vi.mock("@/app/hub/stories/[id]/StoryEditor", () => ({ StoryEditor: () => null }));

afterEach(() => {
  cleanup();
});

function makeProps(over: Partial<StoryDetailClientProps> = {}): StoryDetailClientProps {
  return {
    storyId: "story-1",
    isOwner: false,
    initialTitle: "A Sunday",
    initialTags: [],
    initialProse: "prose",
    initialTranscript: null,
    initialSummary: null,
    audienceTier: "family",
    updatedAt: "2026-01-01T00:00:00.000Z",
    narratorName: "Eleanor",
    eraLabelStr: "1995",
    recordingMediaId: null,
    viewerFamilies: [],
    initialTargetFamilies: [],
    favoriteState: { favoritedByViewer: false, count: 0 },
    likeState: { likedByViewer: false, count: 0, likers: [] },
    canReact: false,
    backHref: "/hub?tab=stories",
    storyImages: [],
    initialPersonSubjects: [],
    tagSuggestions: { people: [], families: [], tags: [] },
    ...over,
  };
}

describe("StoryDetailClient — View in family tree", () => {
  it("renders the tree link with the passed href near the narrator byline", () => {
    const href = "/hub?tab=family&families=fam-a&anchor=p1";
    render(<StoryDetailClient {...makeProps({ authorTreeHref: href })} />);

    const link = screen.getByTestId("story-tree-link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveProperty("textContent", hub.tree.openInTree);
    expect(link.getAttribute("href")).toBe(href);
  });

  it("omits the tree link when authorTreeHref is absent", () => {
    render(<StoryDetailClient {...makeProps({ authorTreeHref: null })} />);
    expect(screen.queryByTestId("story-tree-link")).toBeNull();
  });
});
