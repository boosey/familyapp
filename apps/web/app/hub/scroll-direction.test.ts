/**
 * ADR-0025 mobile Phase B, Increment 2 — the pure scroll-direction reducer that decides whether the
 * collapse-on-scroll header is hidden. Drives scrollY samples up/down past the thresholds and pins the
 * show/hide + re-baseline rules (the behaviour the header + iOS overscroll depend on).
 */
import { describe, expect, it } from "vitest";
import {
  HEADER_REVEAL_AT_TOP_PX,
  HEADER_SCROLL_DELTA_PX,
  INITIAL_HEADER_STATE,
  nextHeaderState,
} from "./scroll-direction";

describe("nextHeaderState", () => {
  it("stays shown at the very top", () => {
    const s = nextHeaderState(INITIAL_HEADER_STATE, 0);
    expect(s.hidden).toBe(false);
  });

  it("keeps the header shown within the top reveal zone", () => {
    const s = nextHeaderState({ hidden: true, lastY: 200 }, HEADER_REVEAL_AT_TOP_PX);
    expect(s.hidden).toBe(false);
    expect(s.lastY).toBe(HEADER_REVEAL_AT_TOP_PX);
  });

  it("hides when scrolling DOWN past the delta threshold", () => {
    const start = { hidden: false, lastY: 100 };
    const s = nextHeaderState(start, 100 + HEADER_SCROLL_DELTA_PX);
    expect(s.hidden).toBe(true);
    expect(s.lastY).toBe(100 + HEADER_SCROLL_DELTA_PX);
  });

  it("reveals when scrolling UP past the delta threshold", () => {
    const start = { hidden: true, lastY: 300 };
    const s = nextHeaderState(start, 300 - HEADER_SCROLL_DELTA_PX);
    expect(s.hidden).toBe(false);
  });

  it("ignores jitter below the delta threshold (no flicker, no re-baseline)", () => {
    const start = { hidden: false, lastY: 100 };
    const s = nextHeaderState(start, 100 + (HEADER_SCROLL_DELTA_PX - 1));
    expect(s).toBe(start); // identity: no change committed
  });

  it("accumulates many sub-threshold scrolls toward the threshold", () => {
    // Two nudges of (threshold - 1) from the SAME baseline: the second, measured from the unchanged
    // baseline, has crossed the threshold and hides.
    const start = { hidden: false, lastY: 100 };
    const one = nextHeaderState(start, 100 + (HEADER_SCROLL_DELTA_PX - 1)); // no-op, baseline stays 100
    expect(one).toBe(start);
    const two = nextHeaderState(one, 100 + HEADER_SCROLL_DELTA_PX + 2); // now past threshold from 100
    expect(two.hidden).toBe(true);
  });

  it("treats iOS negative overscroll as the top (shown)", () => {
    const s = nextHeaderState({ hidden: true, lastY: 5 }, -40);
    expect(s.hidden).toBe(false);
    expect(s.lastY).toBe(0);
  });

  it("degrades a non-finite scrollY to the shown resting state", () => {
    const s = nextHeaderState({ hidden: true, lastY: 200 }, Number.NaN);
    expect(s).toEqual(INITIAL_HEADER_STATE);
  });

  it("re-baselines lastY while staying hidden on continued downward scroll", () => {
    const start = { hidden: true, lastY: 300 };
    const s = nextHeaderState(start, 400);
    expect(s.hidden).toBe(true);
    expect(s.lastY).toBe(400);
  });
});
