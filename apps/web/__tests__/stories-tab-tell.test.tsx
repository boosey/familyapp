// @vitest-environment jsdom
/**
 * Task 11: the Stories tab must offer a self-initiated "Tell a story" entry (→ /hub/tell) and, when
 * the narrator has ask-less drafts still in review, a "Finish what you started" resume list. Each
 * resume item links to /hub/tell/[storyId]. Both surfaces render regardless of whether the feed is
 * empty (they sit above the browse). selfDrafts carry ISO recordedAt strings (serialized upstream).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoriesTab } from "@/app/hub/tabs/StoriesTab";

// #190: the Stories body is the client StoriesSurface, which reads the initial browse mode from `?mode=`
// via useSearchParams (and mounts FamilyChips for ≥2 families). These tests use 0 families, so only the
// search-params hook is exercised; mock it to an empty query (default "feed" mode).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

const baseProps = {
  feed: [],
  viewerPersonId: "v1",
  seenStoryIds: new Set<string>(),
  familyTargets: new Map(),
  storyCovers: new Map<string, string>(),
  storyPhotos: new Map<string, string[]>(),
  viewerFamilies: [],
  viewerName: "You",
  filter: { kind: "all" } as const,
  activeFamilies: [],
};

afterEach(() => {
  cleanup();
});

describe("StoriesTab — tell a story entry", () => {
  it("shows a 'Tell a story' entry linking to /hub/tell", () => {
    render(<StoriesTab {...baseProps} selfDrafts={[]} />);
    const link = screen.getByRole("link", { name: /tell a story/i });
    expect(link.getAttribute("href")).toBe("/hub/tell");
  });

  it("lists a self-initiated pending draft with a resume link", () => {
    // #125: the resume list now lives behind the compact draft-reminder button in the control row —
    // collapsed by default, it expands in place on click. Open it, then assert the per-draft link.
    render(
      <StoriesTab
        {...baseProps}
        selfDrafts={[{ storyId: "s1", kind: "text", recordedAt: new Date().toISOString() }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /draft/i }));
    expect(screen.getByRole("link", { name: /finish|resume/i }).getAttribute("href")).toBe(
      "/hub/tell/s1",
    );
  });
});
