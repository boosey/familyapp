/**
 * Scroll-direction reducer — the pure, testable half of the collapse-on-scroll header (ADR-0025
 * Phase B, Increment 2). {@link useScrollDirection} reads `window.scrollY` on a rAF-throttled passive
 * listener and feeds each sample through {@link nextHeaderState}; the header component turns the
 * resulting `hidden` flag into a `transform: translateY(-100%)` CSS class.
 *
 * ASYMMETRIC HYSTERESIS (the iOS "reappear on scroll-stop" fix). An earlier version revealed on any
 * upward delta ≥ 6px, symmetric with hide. On iOS Safari the end of a scroll gesture/momentum emits a
 * scroll event with a slightly LOWER scrollY (momentum settle-back and/or the dynamic toolbar
 * re-expanding), trivially exceeding 6px — so the header falsely re-appeared without the finger moving
 * up. The fix anchors to the DEEPEST scroll point reached while hidden and requires a LARGE, deliberate
 * up-scroll to reveal; hiding stays a small, responsive move. The decision lives here (not in the hook)
 * so it is unit-tested in one place; the hook stays a thin listener (mirrors _landing/landing-motion.ts).
 */

/** Below this scroll position the header is ALWAYS shown — near the top there is nothing to reclaim,
 *  and a collapsed header at rest reads as broken. Also absorbs iOS rubber-band overscroll (a momentary
 *  negative/small scrollY) without flicker. */
export const HEADER_REVEAL_AT_TOP_PX = 8;

/** Downward move (px) from the shown anchor (the highest recent point) that HIDES the header. Small, so
 *  hiding stays responsive to a deliberate downward read. */
export const HEADER_HIDE_DELTA_PX = 8;

/**
 * Upward move (px) from the DEEPEST point reached while hidden that REVEALS the header. Deliberately
 * LARGE so it clears iOS momentum settle-back and dynamic-toolbar jumps (which can shift scrollY by
 * tens of px when a gesture ends) — only a sustained, intentional up-scroll reveals. This is THE tuning
 * knob for reveal-responsiveness vs false-reveal immunity: lower it if reveal feels too stiff on-device,
 * raise it if the header still false-reveals on scroll-stop. The owner calibrates this on real iOS.
 */
export const HEADER_REVEAL_DELTA_PX = 64;

export interface HeaderScrollState {
  /** Whether the header is currently hidden (translated out of view). */
  hidden: boolean;
  /** The reference point the next delta is measured from. While SHOWN it tracks the highest recent
   *  point (smallest y); while HIDDEN it tracks the deepest point reached (largest y). */
  anchorY: number;
}

/** The resting state: shown, anchored at the top. */
export const INITIAL_HEADER_STATE: HeaderScrollState = { hidden: false, anchorY: 0 };

/**
 * Given the previous state and the current scrollY, decide the next header state.
 *
 * Rules, in order:
 *  1. Near the very top (`<= HEADER_REVEAL_AT_TOP_PX`) → always shown, re-baseline the anchor.
 *  2. While HIDDEN: the anchor follows the DEEPEST point (`max(prev.anchorY, y)`), so scrolling further
 *     down just moves the anchor. Reveal only when the viewer has scrolled UP at least
 *     `HEADER_REVEAL_DELTA_PX` from that deepest point (a deliberate up-scroll, not a settle-back).
 *  3. While SHOWN: the anchor follows the HIGHEST point (`min(prev.anchorY, y)`). Hide once the viewer
 *     has scrolled DOWN at least `HEADER_HIDE_DELTA_PX` from it.
 *
 * Returns `prev` (referential equality) when nothing changed, so the hook's identity skip holds; returns
 * a NEW object whenever `hidden` OR `anchorY` changes (anchor-only moves must persist to the hook's ref).
 * Pure and finite-safe: a non-finite scrollY degrades to the shown resting state.
 */
export function nextHeaderState(prev: HeaderScrollState, scrollY: number): HeaderScrollState {
  if (!Number.isFinite(scrollY)) return INITIAL_HEADER_STATE;

  // Clamp negative (iOS overscroll) to 0 so the top-reveal rule and deltas behave.
  const y = scrollY < 0 ? 0 : scrollY;

  if (y <= HEADER_REVEAL_AT_TOP_PX) {
    return prev.hidden || prev.anchorY !== y ? { hidden: false, anchorY: y } : prev;
  }

  if (prev.hidden) {
    // Anchor tracks the deepest point reached while hidden.
    const anchorY = Math.max(prev.anchorY, y);
    if (anchorY - y >= HEADER_REVEAL_DELTA_PX) {
      return { hidden: false, anchorY: y }; // deliberate up-scroll → reveal
    }
    return anchorY === prev.anchorY ? prev : { hidden: true, anchorY };
  }

  // Shown: anchor tracks the highest point (smallest y).
  const anchorY = Math.min(prev.anchorY, y);
  if (y - anchorY >= HEADER_HIDE_DELTA_PX) {
    return { hidden: true, anchorY: y }; // down-scroll past threshold → hide
  }
  return anchorY === prev.anchorY ? prev : { hidden: false, anchorY };
}
