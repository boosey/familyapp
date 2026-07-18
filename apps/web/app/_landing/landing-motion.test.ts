import { describe, expect, it } from "vitest";
import {
  SCROLL_SPEEDS,
  clamp01,
  scrollFraction,
  parallaxOffset,
  heroExit,
} from "./landing-motion";

describe("clamp01", () => {
  it("passes through values already in [0,1]", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
  });
  it("clamps out-of-range values", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(2.5)).toBe(1);
  });
  it("treats non-finite input as 0 (never leaks NaN/Infinity into a transform)", () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("scrollFraction", () => {
  it("is 0 at the top and 1 at the bottom", () => {
    // scrollHeight 2000, viewport 800 → scrollable range is 1200.
    expect(scrollFraction(0, 2000, 800)).toBe(0);
    expect(scrollFraction(600, 2000, 800)).toBe(0.5);
    expect(scrollFraction(1200, 2000, 800)).toBe(1);
  });
  it("clamps overscroll (rubber-banding) to 1 and negative scroll to 0", () => {
    expect(scrollFraction(9999, 2000, 800)).toBe(1);
    expect(scrollFraction(-50, 2000, 800)).toBe(0);
  });
  it("returns 0 when the page is not scrollable (content shorter than viewport)", () => {
    expect(scrollFraction(0, 500, 800)).toBe(0);
    expect(scrollFraction(0, 800, 800)).toBe(0);
  });
});

describe("parallaxOffset", () => {
  it("scales scroll position by the layer speed", () => {
    expect(parallaxOffset(1000, 0.1)).toBe(100);
    expect(parallaxOffset(0, 0.5)).toBe(0);
  });
  it("supports the named speed channels", () => {
    expect(parallaxOffset(1000, SCROLL_SPEEDS.slow)).toBeCloseTo(1000 * SCROLL_SPEEDS.slow);
    expect(SCROLL_SPEEDS.slow).toBeLessThan(SCROLL_SPEEDS.medium);
    expect(SCROLL_SPEEDS.medium).toBeLessThan(SCROLL_SPEEDS.fast);
  });
  it("guards non-finite results back to 0", () => {
    expect(parallaxOffset(Number.NaN, 0.2)).toBe(0);
  });
});

describe("heroExit", () => {
  it("is 0 at the top and reaches 1 after one viewport of scroll", () => {
    expect(heroExit(0, 800)).toBe(0);
    expect(heroExit(400, 800)).toBe(0.5);
    expect(heroExit(800, 800)).toBe(1);
    expect(heroExit(2000, 800)).toBe(1);
  });
  it("returns 0 for a zero/negative viewport (never divides by zero)", () => {
    expect(heroExit(400, 0)).toBe(0);
    expect(heroExit(400, -100)).toBe(0);
  });
});
