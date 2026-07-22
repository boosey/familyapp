// @vitest-environment jsdom
/**
 * Scrapbook signature regression (#209). The story READ surface carries the four structural moves that
 * mirror StoryCard — highlighter-washed title, sticker candy tags (i % 4 rotation), and a media/photo
 * block that takes the tape+tilt+hover-lift (NOT the whole static page) plus a warmed reactions row.
 * The decoration itself is CSS-only and skin-scoped (jsdom can't compute it), so these assert the
 * durable STRUCTURE: the right module classes land on the right elements, the per-item --tilt custom
 * property is set on the media block, and the module ships the reduce-motion + solemn suppression
 * selectors so the signature is guarded. Values/pixels are NOT asserted (that's the browser's job).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StoryDetailClient, type StoryDetailClientProps } from "./StoryDetailClient";
import styles from "./StoryDetailClient.module.css";

vi.mock("./actions", () => ({
  editStoryDetailsAction: vi.fn(),
  editStoryDateAction: vi.fn(),
  retargetStoryFamiliesAction: vi.fn(),
  editStoryProseAction: vi.fn(),
  tagStorySubjectAction: vi.fn(),
  untagStorySubjectAction: vi.fn(),
  setStoryLikeAction: vi.fn(),
}));
vi.mock("./FavoriteButton", () => ({ FavoriteButton: () => null }));
vi.mock("./LikeButton", () => ({ LikeButton: () => null }));
vi.mock("./FollowUpButton", () => ({ FollowUpButton: () => null }));
vi.mock("./OwnerActionMenu", () => ({ OwnerActionMenu: () => null }));
vi.mock("./StoryEditor", () => ({ StoryEditor: () => null }));
vi.mock("./StoryDateEditor", () => ({ StoryDateEditor: () => null }));

afterEach(cleanup);

function makeProps(over: Partial<StoryDetailClientProps> = {}): StoryDetailClientProps {
  return {
    storyId: "story-1",
    isOwner: false,
    narratorPersonId: "narrator-1",
    canAskFollowUp: false,
    initialTitle: "The Long Drive Home",
    initialTags: ["boats", "1962", "naples", "summer", "harbor"],
    initialProse: "THE_PROSE_MARKER",
    initialTranscript: null,
    initialSummary: null,
    audienceTier: "family",
    updatedAt: "2026-01-01T00:00:00.000Z",
    narratorName: "Eleanor",
    eraLabelStr: "1962 · NAPLES",
    storyDate: null,
    storyDateProvenance: null,
    recordingMediaId: null,
    viewerFamilies: [],
    initialTargetFamilies: [{ id: "f1", name: "Boudreaux", shortName: "B" }],
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

describe("StoryDetailClient — Scrapbook signature structure (#209)", () => {
  it("washes the title with the highlighter class", () => {
    render(<StoryDetailClient {...makeProps()} />);
    const title = screen.getByText("The Long Drive Home");
    expect(title.className).toContain(styles.title);
  });

  it("stickerizes content tags cycling the four candy palettes (i % 4)", () => {
    render(<StoryDetailClient {...makeProps()} />);

    // Five tags → sticker0..3 then wraps back to sticker0.
    const expected = [
      ["boats", styles.sticker0],
      ["1962", styles.sticker1],
      ["naples", styles.sticker2],
      ["summer", styles.sticker3],
      ["harbor", styles.sticker0],
    ] as const;

    for (const [text, palette] of expected) {
      const el = screen.getByText(text);
      expect(el.className).toContain(styles.sticker);
      expect(el.className).toContain(palette);
    }
  });

  it("does NOT stickerize family target tags (they keep the family-tag look)", () => {
    render(<StoryDetailClient {...makeProps()} />);
    const family = screen.getByText("B");
    expect(family.className).toContain(styles.familyTag);
    expect(family.className).not.toContain(styles.sticker);
  });

  it("gives the media/photo block the tape+tilt class and an inline --tilt, not the page", () => {
    render(
      <StoryDetailClient
        {...makeProps({ storyImages: [{ id: "i1", familyPhotoId: "p1", caption: null }] })}
      />,
    );
    const media = screen.getByTestId("story-photo-row");
    expect(media.className).toContain(styles.mediaBlock);
    // The parity-driven tilt is set inline (JS math → CSS var); its presence is the guarantee.
    expect((media as HTMLElement).style.getPropertyValue("--tilt")).toBe("0.55deg");

    // The outer page wrapper is NOT tilted — a wobbling full-width page reads as a bug.
    const page = media.closest(`.${styles.page}`) as HTMLElement;
    expect(page).toBeTruthy();
    expect(page.className).not.toContain(styles.mediaBlock);
  });

  it("wraps the reactions row in the warmable reactions panel class", () => {
    const { container } = render(<StoryDetailClient {...makeProps()} />);
    expect(container.querySelector(`.${styles.reactions}`)).toBeTruthy();
  });

  it("ships reduce-motion AND cascade-winning solemn suppression selectors for every signature", () => {
    // The signature is CSS-only; jsdom can't compute the cascade, so assert the guard selectors exist
    // in the module source. Vitest runs from the @chronicle/web package root; read by repo-relative
    // path (import.meta.url points at the transformed test module, not a file:// path here).
    const cssPath = join(process.cwd(), "app/hub/stories/[id]/StoryDetailClient.module.css");
    const css = readFileSync(cssPath, "utf8");

    // Reduce-motion suppressors win because they use :root (tie the Scrapbook rule's 0,3,0, later in
    // source). Assert one exists per signature.
    for (const cls of ["title", "mediaBlock", "reactions"]) {
      expect(css).toMatch(new RegExp(`\\[data-reduce-motion="on"\\][^{]*\\.${cls}`));
    }
    // Solemn is the load-bearing regression (#209 follow-up): the Scrapbook rules are
    // `:root[data-skin="scrapbook"] .x` (specificity 0,3,0) and data-tone is applied on a CONTAINER, so a
    // bare `[data-tone="solemn"] .x` (0,2,0) LOSES the cascade and fails to suppress. Require the
    // `[data-skin="scrapbook"]` prefix in the SAME selector (=> 0,4,0) so the suppressor actually wins.
    for (const cls of ["title", "mediaBlock", "reactions"]) {
      expect(css).toMatch(
        new RegExp(`\\[data-skin="scrapbook"\\][^{]*\\[data-tone="solemn"\\][^{]*\\.${cls}`),
      );
    }
    // The primary CTA gradient is a color signature that must revert to solid accent under solemn,
    // also cascade-winning.
    expect(css).toMatch(/\[data-skin="scrapbook"\][^{]*\[data-tone="solemn"\][^{]*\.btnPrimary/);
    // The tape strip is a ::before that must be display:none under suppression.
    expect(css).toContain(".mediaBlock::before");
  });
});
