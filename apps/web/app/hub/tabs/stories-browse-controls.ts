/**
 * Shared Stories-browse control contract (#190). The mode toggle, the Search field, and the
 * Masonry/Column feed-view selector were hoisted out of the browse body ({@link StoryBrowse}) into the
 * shared two-row HubToolbar ({@link StoriesSurface}). Both files read the SAME mode/view types + the
 * feed-view persistence key + mode list from here, so the toolbar (which drives the state) and the body
 * (which renders it) can never disagree — a single source of truth per CLAUDE.md's centralization rule.
 */

/** The three browse modes of the Stories surface. */
export type BrowseMode = "feed" | "timeline" | "search";

/** Every browse mode, in display/pill order. */
export const BROWSE_MODES: BrowseMode[] = ["feed", "timeline", "search"];

/** Feed layout (Feed mode only): a single stacked column of wide cards, or a masonry of cards. */
export type FeedView = "column" | "masonry";

/** localStorage key for the persisted feed-view choice (a stored preference beats the default). */
export const FEED_VIEW_KEY = "hub:feedView";

export function isFeedView(v: string | null): v is FeedView {
  return v === "column" || v === "masonry";
}
