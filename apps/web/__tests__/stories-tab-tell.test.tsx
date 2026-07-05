// @vitest-environment jsdom
/**
 * Task 11: the Stories tab must offer a self-initiated "Tell a story" entry (→ /hub/tell) and, when
 * the narrator has ask-less drafts still in review, a "Finish what you started" resume list. Each
 * resume item links to /hub/tell/[storyId]. Both surfaces render regardless of whether the feed is
 * empty (they sit above the browse). selfDrafts carry ISO recordedAt strings (serialized upstream).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StoriesTab } from "@/app/hub/tabs/StoriesTab";

const baseProps = {
  feed: [],
  viewerPersonId: "v1",
  seenStoryIds: new Set<string>(),
  familyTargets: new Map(),
  storyCovers: new Map<string, string>(),
  viewerFamilies: [],
  viewerName: "You",
  scope: "all",
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
    render(
      <StoriesTab
        {...baseProps}
        selfDrafts={[{ storyId: "s1", kind: "text", recordedAt: new Date().toISOString() }]}
      />,
    );
    expect(screen.getByRole("link", { name: /finish|resume/i }).getAttribute("href")).toBe(
      "/hub/tell/s1",
    );
  });
});
