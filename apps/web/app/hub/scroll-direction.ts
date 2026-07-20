/**
 * Scroll-direction reducer — the pure, testable half of the collapse-on-scroll header (ADR-0025
 * Phase B, Increment 2). {@link useScrollDirection} reads `window.scrollY` on a rAF-throttled passive
 * listener and feeds each sample through {@link nextHeaderState}; the header component turns the
 * resulting `hidden` flag into a `transform: translateY(-100%)` CSS class.
 *
 * Keeping the decision here (not inside the hook) means the show/hide rules are unit-tested in one
 * place and the hook stays a thin listener. Mirrors `_landing/landing-motion.ts` (JS does the math,
 * the component/CSS consumes it).
 */

/** Below this scroll position the header is ALWAYS shown — near the top there is nothing to reclaim,
 *  and a collapsed header at rest reads as broken. A few px of slack also absorbs iOS rubber-band
 *  overscroll (a momentary negative/small scrollY) without flicker. */
export const HEADER_REVEAL_AT_TOP_PX = 8;

/** Minimum scroll delta (px) between samples before we act on a direction change. Small jitters (a
 *  trackpad nudge, a sub-pixel momentum tail) under this threshold are ignored so the bar doesn't
 *  flicker open/closed. */
export const HEADER_SCROLL_DELTA_PX = 6;

export interface HeaderScrollState {
  /** Whether the header is currently hidden (translated out of view). */
  hidden: boolean;
  /** The last scrollY we committed a decision at — the baseline for the next delta. */
  lastY: number;
}

/** The resting state: shown, anchored at the top. */
export const INITIAL_HEADER_STATE: HeaderScrollState = { hidden: false, lastY: 0 };

/**
 * Given the previous state and the current scrollY, decide the next header state.
 *
 * Rules, in order:
 *  1. Near the very top (`<= HEADER_REVEAL_AT_TOP_PX`) → always shown (and re-baseline).
 *  2. Movement smaller than `HEADER_SCROLL_DELTA_PX` since the last committed sample → no change, no
 *     re-baseline (so many tiny scrolls still accumulate toward the threshold).
 *  3. Scrolling DOWN past the threshold → hide; scrolling UP past it → show. Either way re-baseline.
 *
 * Pure and finite-safe: a non-finite scrollY degrades to the shown resting state.
 */
export function nextHeaderState(prev: HeaderScrollState, scrollY: number): HeaderScrollState {
  if (!Number.isFinite(scrollY)) return INITIAL_HEADER_STATE;

  // Clamp negative (iOS overscroll) to 0 so the top-reveal rule and deltas behave.
  const y = scrollY < 0 ? 0 : scrollY;

  if (y <= HEADER_REVEAL_AT_TOP_PX) {
    return prev.hidden || prev.lastY !== y ? { hidden: false, lastY: y } : prev;
  }

  const delta = y - prev.lastY;
  if (Math.abs(delta) < HEADER_SCROLL_DELTA_PX) return prev;

  // delta > 0 → scrolled down → hide; delta < 0 → scrolled up → show.
  const hidden = delta > 0;
  return hidden === prev.hidden ? { ...prev, lastY: y } : { hidden, lastY: y };
}
