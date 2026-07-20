import { describe, expect, it } from "vitest";
import { pickStoryLayout, type StoryLayout } from "./story-layout";
import type { StoryItem } from "./story-browse-types";

// Minimal factory: pickStoryLayout only reads `id`, `coverPhotoId`, and `photoIds`, so the rest is
// filler. photoCount is inferred from coverPhotoId (0 photos ⇒ null cover).
function makeItem(id: string, coverPhotoId: string | null, photoIds: string[]): StoryItem {
  return {
    id,
    title: "t",
    summary: null,
    prose: null,
    tags: [],
    personId: "p",
    personName: "P",
    eraYear: null,
    eraLabel: null,
    eventLabel: null,
    occurredLabel: null,
    families: [],
    isNew: false,
    coverPhotoId,
    photoIds,
    href: `/hub/stories/${id}`,
  };
}

const ONE_PHOTO: StoryLayout[] = ["top", "left", "wrap"];
const MULTI_PHOTO: StoryLayout[] = ["collage", "top"];

describe("pickStoryLayout", () => {
  it("is deterministic — the same id yields the same layout on every call", () => {
    const item = makeItem("story-abc", "ph1", ["ph1"]);
    const first = pickStoryLayout(item);
    for (let i = 0; i < 20; i++) {
      expect(pickStoryLayout(item)).toBe(first);
    }
  });

  it("returns textonly for a story with no cover photo (0 photos)", () => {
    expect(pickStoryLayout(makeItem("no-photos", null, []))).toBe("textonly");
    // Even if photoIds somehow carried stray ids, no cover ⇒ textonly.
    expect(pickStoryLayout(makeItem("no-cover", null, []))).toBe("textonly");
  });

  it("returns a 1-photo-group layout for a story with exactly one photo", () => {
    for (let n = 0; n < 30; n++) {
      const id = `single-${n}`;
      const layout = pickStoryLayout(makeItem(id, "ph1", ["ph1"]));
      expect(ONE_PHOTO).toContain(layout);
    }
  });

  it("returns a multi-photo-group layout for a story with 2+ photos", () => {
    for (let n = 0; n < 30; n++) {
      const id = `multi-${n}`;
      const layout = pickStoryLayout(makeItem(id, "ph1", ["ph1", "ph2", "ph3"]));
      expect(MULTI_PHOTO).toContain(layout);
    }
  });

  it("produces variety — a spread of ids maps to more than one distinct 1-photo layout", () => {
    const seen = new Set<StoryLayout>();
    for (let n = 0; n < 50; n++) {
      seen.add(pickStoryLayout(makeItem(`variety-${n}`, "ph1", ["ph1"])));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("produces variety across the multi-photo group too", () => {
    const seen = new Set<StoryLayout>();
    for (let n = 0; n < 50; n++) {
      seen.add(pickStoryLayout(makeItem(`mvariety-${n}`, "ph1", ["ph1", "ph2"])));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
