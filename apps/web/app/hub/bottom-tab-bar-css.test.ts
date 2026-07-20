/**
 * ADR-0025 mobile Phase B, Increment 1 — CSS contract regression guards for the bottom tab bar.
 *
 * These string-scan the CSS on disk (the CSS-module import is a class-name proxy, not text) to bond the
 * two things that only ever break on a real phone and so can't be asserted in jsdom:
 *  (a) the bar clears the iOS home indicator — it reads `env(safe-area-inset-bottom)`;
 *  (b) the hub content reserves room for the fixed bar — `.main` pads its bottom by the bar height +
 *      the same safe-area inset (so the last content row is never hidden behind the bar).
 * Coarse on purpose (presence of the load-bearing declaration), matching responsive-breakpoints.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("BottomTabBar CSS contract (regression)", () => {
  it("the bar is fixed to the bottom and clears the home indicator", () => {
    const css = readFileSync(join(HERE, "BottomTabBar.module.css"), "utf8");
    expect(css).toContain("position: fixed");
    expect(css).toContain("bottom: 0");
    expect(css).toContain("env(safe-area-inset-bottom)");
    // It must sit below the BottomSheet overlay (its own z-token, not a raw z-index above 1000).
    expect(css).toContain("z-index: var(--bottom-bar-z)");
  });

  it("the hub content reserves bottom room for the fixed bar (phone only)", () => {
    const css = readFileSync(join(HERE, "page.module.css"), "utf8");
    // Base `.main` pads by the bar height + safe area so the last row isn't hidden behind the bar.
    expect(css).toContain("padding-bottom: calc(var(--bottom-bar-height) + env(safe-area-inset-bottom))");
    // The reserve is dropped on desktop (no bottom bar there).
    const smLayer = css.slice(css.indexOf("@media (min-width: 40rem)"));
    expect(smLayer).toContain("padding-bottom: 0");
  });
});
