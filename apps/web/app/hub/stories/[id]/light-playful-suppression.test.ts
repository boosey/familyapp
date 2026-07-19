/**
 * Light-playful suppression regression (#209, cold-review follow-up).
 *
 * The three "light playful" story-detail form surfaces (StoryEditor, FollowUpButton, OwnerActionMenu)
 * each carry exactly one decorative warmth treatment, and the acceptance criteria require every such
 * treatment to be suppressed under the right tone/motion axes. The suppression is CSS-only (jsdom can't
 * compute it), so — like StoryDetailClient.playful.test.tsx — these assert the guard selectors exist in
 * the module SOURCE. This closes the gap the cold reviewer flagged: without it, a future refactor of
 * these three modules could silently drop a suppressor with no red test.
 *
 * NOTE the axes differ by treatment, and that difference is the point being locked in:
 *  - StoryEditor's only skin touch is a warm focus GLOW — a static color/shadow state change, not
 *    motion — so it is intentionally suppressed under SOLEMN ONLY (no reduce-motion rule). Asserting
 *    the absence of a reduce-motion rule would be over-fitting, so we only pin the solemn guard.
 *  - FollowUpButton / OwnerActionMenu add box-shadow DEPTH on a primary button, which is decorative
 *    lift → suppressed under BOTH reduce-motion AND solemn.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the @chronicle/web package root; read each module CSS by repo-relative path.
function readModule(basename: string): string {
  return readFileSync(join(process.cwd(), "app/hub/stories/[id]", basename), "utf8");
}

// A guard-selector matcher: `[<attr>] ... .<class>` on a single rule head (up to the `{`).
function guardCovers(css: string, attr: string, className: string): boolean {
  return new RegExp(`\\[${escapeRe(attr)}\\][^{]*\\.${escapeRe(className)}`).test(css);
}

const REDUCE_MOTION = 'data-reduce-motion="on"';
const SOLEMN = 'data-tone="solemn"';

describe("Light-playful form surfaces — suppression guards (#209)", () => {
  it("StoryEditor drops the warm focus glow under solemn (glow is not motion)", () => {
    const css = readModule("StoryEditor.module.css");
    expect(guardCovers(css, SOLEMN, "textField")).toBe(true);
  });

  it("FollowUpButton collapses primary-button depth (both axes) and reverts its gradient under solemn", () => {
    const css = readModule("FollowUpButton.module.css");
    expect(guardCovers(css, REDUCE_MOTION, "btnPrimary")).toBe(true);
    expect(guardCovers(css, SOLEMN, "btnPrimary")).toBe(true);
    // The playful gradient (`:root[data-skin="playful"] .btnPrimary`, 0,3,0) must be reverted by a
    // cascade-WINNING solemn rule: data-skin + data-tone in the same selector (0,4,0). A bare
    // `[data-tone="solemn"]` (0,2,0) would lose, leaving a warm gradient button in a solemn context.
    expect(/\[data-skin="playful"\][^{]*\[data-tone="solemn"\][^{]*\.btnPrimary/.test(css)).toBe(true);
  });

  it("OwnerActionMenu collapses confirm-button depth under BOTH reduce-motion and solemn", () => {
    const css = readModule("OwnerActionMenu.module.css");
    expect(guardCovers(css, REDUCE_MOTION, "btnConfirm")).toBe(true);
    expect(guardCovers(css, SOLEMN, "btnConfirm")).toBe(true);
  });
});

// Attribute selectors contain regex-neutral chars (=, "), but escape defensively.
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
