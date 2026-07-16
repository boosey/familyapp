// @vitest-environment jsdom
/**
 * Story-detail photo row. The attached photos render as a single horizontal row directly below the
 * reaction buttons (moved up from the old bottom grid gallery), showing ALL attached photos, each
 * served by the audited /api/album-photo/[photoId] byte route. There is no second gallery at the
 * bottom of the page — the photos live in exactly one place, above the reading body.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StoryDetailClient, type StoryDetailClientProps } from "@/app/hub/stories/[id]/StoryDetailClient";
import { hub } from "@/app/_copy";

vi.mock("@/app/hub/stories/[id]/actions", () => ({
  editStoryDetailsAction: vi.fn(),
  retargetStoryFamiliesAction: vi.fn(),
  editStoryProseAction: vi.fn(),
  tagStorySubjectAction: vi.fn(),
  untagStorySubjectAction: vi.fn(),
}));
vi.mock("@/app/hub/stories/[id]/FavoriteButton", () => ({ FavoriteButton: () => null }));
vi.mock("@/app/hub/stories/[id]/LikeButton", () => ({ LikeButton: () => null }));
vi.mock("@/app/hub/stories/[id]/FollowUpButton", () => ({ FollowUpButton: () => null }));
vi.mock("@/app/hub/stories/[id]/OwnerActionMenu", () => ({ OwnerActionMenu: () => null }));
vi.mock("@/app/hub/stories/[id]/StoryEditor", () => ({ StoryEditor: () => null }));
// StoryReadBody is intentionally NOT mocked — it renders the prose, our anchor for "the row is ABOVE
// the reading body" (i.e. it was relocated up, not left at the very bottom).

afterEach(() => {
  cleanup();
});

const IMG = (id: string, familyPhotoId: string, caption: string | null = null) => ({
  id,
  familyPhotoId,
  caption,
});

function makeProps(over: Partial<StoryDetailClientProps> = {}): StoryDetailClientProps {
  return {
    storyId: "story-1",
    isOwner: false,
    narratorPersonId: "narrator-1",
    canAskFollowUp: false,
    initialTitle: "A Sunday",
    initialTags: [],
    initialProse: "THE_PROSE_MARKER",
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

function rowSrcs(): string[] {
  const row = screen.queryByTestId("story-photo-row");
  if (!row) return [];
  return Array.from(row.querySelectorAll("img")).map((el) => el.getAttribute("src")) as string[];
}

describe("StoryDetailClient — photo row below reactions", () => {
  it("renders ALL attached photos as a row of byte-route images", () => {
    render(
      <StoryDetailClient
        {...makeProps({
          storyImages: [IMG("i1", "cover"), IMG("i2", "p2"), IMG("i3", "p3")],
        })}
      />,
    );
    expect(rowSrcs()).toEqual([
      "/api/album-photo/cover",
      "/api/album-photo/p2",
      "/api/album-photo/p3",
    ]);
  });

  it("places the photo row ABOVE the reading body (relocated up, not at the bottom)", () => {
    render(<StoryDetailClient {...makeProps({ storyImages: [IMG("i1", "p1")] })} />);
    const row = screen.getByTestId("story-photo-row");
    const prose = screen.getByText("THE_PROSE_MARKER");
    // The prose FOLLOWS the row in document order.
    expect(row.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not render a second bottom gallery heading (photos live in one place)", () => {
    render(<StoryDetailClient {...makeProps({ storyImages: [IMG("i1", "p1")] })} />);
    expect(screen.queryByText(hub.storyImages.galleryHeading)).toBeNull();
  });

  it("renders no photo row when the story has no attached photos", () => {
    render(<StoryDetailClient {...makeProps({ storyImages: [] })} />);
    expect(screen.queryByTestId("story-photo-row")).toBeNull();
  });

  it("uses the caption as alt text when present", () => {
    render(
      <StoryDetailClient
        {...makeProps({ storyImages: [IMG("i1", "p1", "Wedding, 1961")] })}
      />,
    );
    const img = screen.getByAltText("Wedding, 1961");
    expect(img.getAttribute("src")).toBe("/api/album-photo/p1");
  });
});
