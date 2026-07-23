/**
 * Landing-page scroll math — the pure, testable half of the "elements move as you scroll"
 * experience. `LandingExperience.tsx` reads `window.scrollY` on a rAF loop and feeds it through
 * these functions, then writes the results to CSS custom properties that `landing.module.css`
 * consumes (the repo's "JS does the math → CSS consumes a var" rule). Keeping the math here means
 * it is unit-tested and lives in ONE place; the module CSS never hardcodes a motion factor.
 *
 * Every function is finite-safe: a division that produces NaN/Infinity (0-height page, 0 viewport)
 * degrades to a resting `0`, so the landing can never paint a garbage transform.
 */

/**
 * Parallax speed channels — fraction of scroll distance each depth layer travels. Smaller = further
 * away (drifts less). Three named channels keep the module CSS declarative: a layer picks a channel
 * (`--py-slow` / `--py-medium` / `--py-fast`) rather than inventing its own number.
 */
export const SCROLL_SPEEDS = {
  slow: 0.16,
  medium: 0.32,
  fast: 0.56,
} as const;

export type ScrollSpeedChannel = keyof typeof SCROLL_SPEEDS;

/** Clamp to [0,1]; non-finite input degrades to 0. */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Overall scroll progress in [0,1] — 0 at the top, 1 at the very bottom. Drives the thin coral
 * progress rail. Returns 0 when the document is not taller than the viewport (nothing to scroll).
 */
export function scrollFraction(
  scrollY: number,
  scrollHeight: number,
  viewportHeight: number,
): number {
  const scrollable = scrollHeight - viewportHeight;
  if (scrollable <= 0) return 0;
  return clamp01(scrollY / scrollable);
}

/** Parallax translate in px for a layer travelling at `speed` of the scroll distance. */
export function parallaxOffset(scrollY: number, speed: number): number {
  const px = scrollY * speed;
  return Number.isFinite(px) ? px : 0;
}

/**
 * How far the hero has been scrolled away, in [0,1], reaching 1 after exactly one viewport of
 * scroll. Drives the hero's fade + lift so it hands off to the first content section.
 */
export function heroExit(scrollY: number, viewportHeight: number): number {
  if (viewportHeight <= 0) return 0;
  return clamp01(scrollY / viewportHeight);
}
