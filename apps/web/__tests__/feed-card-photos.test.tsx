// @vitest-environment jsdom
/**
 * FeedCard non-cover thumbnail row. Below the tags, the Story Browse feed card renders the story's
 * NON-cover accompaniment photos as a small thumbnail row (the cover already shows big on the left).
 * Each thumbnail is served by the audited /api/album-photo/[photoId] byte route. A story with only a
 * cover — or no photos at all — renders no thumbnail row. FeedCard is internal to StoryBrowse, so we
 * drive it through the feed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StoryBrowse } from "@/app/hub/tabs/StoryBrowse";
import type { StoryItem } from "@/app/hub/tabs/story-browse-types";

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
    photoIds: over.photoIds ?? [],
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
      selectedIds={[]}
      allSelected={true}
    />,
  );
}

function thumbSrcs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="card-photo-thumb"]')).map((el) =>
    el.getAttribute("src"),
  ) as string[];
}

describe("FeedCard non-cover thumbnail row", () => {
  it("renders a thumbnail for each NON-cover photo, excluding the cover", () => {
    const { container } = renderFeed([
      makeItem({ id: "s1", coverPhotoId: "cover", photoIds: ["cover", "p2", "p3"] }),
    ]);
    expect(thumbSrcs(container)).toEqual([
      "/api/album-photo/p2",
      "/api/album-photo/p3",
    ]);
  });

  it("renders NO thumbnail row when the story has only a cover", () => {
    const { container } = renderFeed([
      makeItem({ id: "s1", coverPhotoId: "cover", photoIds: ["cover"] }),
    ]);
    expect(thumbSrcs(container)).toEqual([]);
  });

  it("renders NO thumbnail row for a text-only story (no photos)", () => {
    const { container } = renderFeed([makeItem({ id: "s1", coverPhotoId: null, photoIds: [] })]);
    expect(thumbSrcs(container)).toEqual([]);
  });

  it("shows non-cover thumbnails only on the card that has extras in a mixed feed", () => {
    const { container } = renderFeed([
      makeItem({ id: "many", coverPhotoId: "c", photoIds: ["c", "x", "y"] }),
      makeItem({ id: "coverOnly", coverPhotoId: "c2", photoIds: ["c2"] }),
    ]);
    expect(thumbSrcs(container)).toEqual([
      "/api/album-photo/x",
      "/api/album-photo/y",
    ]);
  });
});
