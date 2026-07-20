/**
 * ADR-0025 mobile Phase B, Increment 2 — the pure scroll-direction reducer that decides whether the
 * collapse-on-scroll header is hidden. ASYMMETRIC HYSTERESIS: hide is a small move from the highest
 * recent point; reveal needs a LARGE deliberate up-scroll from the deepest point reached while hidden.
 * The key regression here guards the iOS "reappear on scroll-stop" bug — a small settle-back must NOT
 * reveal the header.
 */
import { describe, expect, it } from "vitest";
import {
  HEADER_HIDE_DELTA_PX,
  HEADER_REVEAL_AT_TOP_PX,
  HEADER_REVEAL_DELTA_PX,
  INITIAL_HEADER_STATE,
  nextHeaderState,
} from "./scroll-direction";

describe("nextHeaderState — asymmetric hysteresis", () => {
  it("stays shown at the very top", () => {
    const s = nextHeaderState(INITIAL_HEADER_STATE, 0);
    expect(s.hidden).toBe(false);
  });

  it("keeps the header shown within the top reveal zone and re-baselines the anchor", () => {
    const s = nextHeaderState({ hidden: true, anchorY: 500 }, HEADER_REVEAL_AT_TOP_PX);
    expect(s.hidden).toBe(false);
    expect(s.anchorY).toBe(HEADER_REVEAL_AT_TOP_PX);
  });

  it("hides on a small downward move past the hide threshold", () => {
    const start = { hidden: false, anchorY: 100 };
    const s = nextHeaderState(start, 100 + HEADER_HIDE_DELTA_PX);
    expect(s.hidden).toBe(true);
    expect(s.anchorY).toBe(100 + HEADER_HIDE_DELTA_PX);
  });

  it("does NOT hide for a downward move under the hide threshold", () => {
    const start = { hidden: false, anchorY: 100 };
    const s = nextHeaderState(start, 100 + (HEADER_HIDE_DELTA_PX - 1));
    expect(s.hidden).toBe(false);
  });

  // ── THE REGRESSION: iOS "reappear on scroll-stop" ──────────────────────────────────────────────
  it("stays hidden through a small settle-back when scrolling STOPS (does not false-reveal)", () => {
    // Scrolled down to 500 → hidden. Momentum/toolbar settle-back nudges scrollY up to 470 (a 30px
    // blip, well under the 64px reveal threshold). The header must STAY hidden — the finger never
    // moved up. Under the OLD symmetric-6px reducer this 30px up-delta would have revealed it.
    const hidden = { hidden: true, anchorY: 500 };
    const afterSettle = nextHeaderState(hidden, 470);
    expect(afterSettle.hidden).toBe(true);
    expect(30).toBeLessThan(HEADER_REVEAL_DELTA_PX); // documents why: the blip is under threshold
  });

  it("anchor follows the deepest point, so a settle-back after scrolling DEEPER still stays hidden", () => {
    // 500 (hidden) → deeper to 800 (anchor follows to 800) → settle back to 770 (30px up) → still hidden.
    let s = { hidden: true, anchorY: 500 };
    s = nextHeaderState(s, 800);
    expect(s.anchorY).toBe(800);
    s = nextHeaderState(s, 770);
    expect(s.hidden).toBe(true);
  });

  it("reveals on a deliberate sustained up-scroll past the reveal threshold", () => {
    // Hidden at deepest 500; sustained up to 430 (70px ≥ 64) → reveal.
    const s = nextHeaderState({ hidden: true, anchorY: 500 }, 430);
    expect(s.hidden).toBe(false);
    expect(s.anchorY).toBe(430);
  });

  it("does NOT reveal just under the reveal threshold", () => {
    const s = nextHeaderState({ hidden: true, anchorY: 500 }, 500 - (HEADER_REVEAL_DELTA_PX - 1));
    expect(s.hidden).toBe(true);
  });

  it("moves the anchor deeper (referential change) while staying hidden on continued down-scroll", () => {
    const start = { hidden: true, anchorY: 300 };
    const s = nextHeaderState(start, 400);
    expect(s).not.toBe(start); // a new object — the anchor must persist to the hook's ref
    expect(s.hidden).toBe(true);
    expect(s.anchorY).toBe(400);
  });

  it("returns prev (identity) while hidden when nothing changed", () => {
    const start = { hidden: true, anchorY: 400 };
    // y below the deepest anchor but not enough to reveal, and not deeper → no change.
    const s = nextHeaderState(start, 400 - (HEADER_REVEAL_DELTA_PX - 10));
    expect(s).toBe(start);
  });

  it("treats iOS negative overscroll as the top (shown)", () => {
    const s = nextHeaderState({ hidden: true, anchorY: 500 }, -40);
    expect(s.hidden).toBe(false);
    expect(s.anchorY).toBe(0);
  });

  it("degrades a non-finite scrollY to the shown resting state", () => {
    const s = nextHeaderState({ hidden: true, anchorY: 200 }, Number.NaN);
    expect(s).toEqual(INITIAL_HEADER_STATE);
  });
});
