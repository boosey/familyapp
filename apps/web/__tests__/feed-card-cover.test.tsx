// @vitest-environment jsdom
/**
 * FeedCard cover accompaniment (ADR-0009 Phase 2). The Story Browse feed card shows the story's cover
 * photo when one exists — served by the audited /api/album-photo/[photoId] byte route — and renders
 * NOTHING in the media slot when there is no cover (a text-only card is first-class; the old striped
 * placeholder is gone). FeedCard is internal to StoryBrowse, so we drive it through the feed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StoryBrowse } from "@/app/hub/tabs/StoryBrowse";
import type { StoryItem } from "@/app/hub/tabs/story-browse-types";

// StoryBrowse reads the initial mode/scope from the URL via useSearchParams — mock it to an empty
// query so it lands in the default "feed" mode with scope "all".
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => {
  cleanup();
});

function makeItem(over: Partial<StoryItem> & { id: string }): StoryItem {
  return {
    id: over.id,
    title: over.title ?? "A Memory",
    summary: over.summary ?? null,
    prose: over.prose ?? null,
    tags: over.tags ?? [],
    personId: over.personId ?? "p1",
    personName: over.personName ?? "Eleanor",
    eraYear: over.eraYear ?? null,
    eraLabel: over.eraLabel ?? null,
    eventLabel: over.eventLabel ?? null,
    families: over.families ?? [],
    isNew: over.isNew ?? false,
    coverPhotoId: over.coverPhotoId ?? null,
    href: over.href ?? `/hub/stories/${over.id}`,
  };
}

function renderFeed(items: StoryItem[]) {
  return render(
    <StoryBrowse
      items={items}
      viewerFamilies={[]}
      viewerPersonId="p1"
      viewerName="You"
      scope="all"
    />,
  );
}

describe("FeedCard cover image", () => {
  it("renders a cover <img> pointing at the audited byte route when the story has a cover", () => {
    const { container } = renderFeed([makeItem({ id: "s1", coverPhotoId: "photo-42" })]);
    const imgs = Array.from(container.querySelectorAll("img"));
    const cover = imgs.find((el) => el.getAttribute("src") === "/api/album-photo/photo-42");
    expect(cover).toBeTruthy();
  });

  it("renders NO image (and no placeholder) when the story has no cover", () => {
    const { container } = renderFeed([makeItem({ id: "s1", coverPhotoId: null })]);
    // The card has no <img> at all — the empty case is text-only, first-class, no placeholder.
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("shows a cover only on the card that has one in a mixed feed", () => {
    const { container } = renderFeed([
      makeItem({ id: "withCover", coverPhotoId: "cover-x" }),
      makeItem({ id: "textOnly", coverPhotoId: null }),
    ]);
    const srcs = Array.from(container.querySelectorAll("img")).map((el) => el.getAttribute("src"));
    expect(srcs).toEqual(["/api/album-photo/cover-x"]);
  });
});
