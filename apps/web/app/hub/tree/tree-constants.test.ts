// Regression + structural guard for the centralized tree constants.
//
// WHY: `NODE_W`/`NODE_H` (card dimensions) were once declared TWICE — in tree-layout.ts (geometry
// math) and person-node.tsx (card render) — so bumping one silently desynced the layout from the
// rendered card and pointed carets/connectors at the wrong edge. And the affordance/card OVERLAP was
// coupled to the button size only by a code comment. These tests fail if either regression returns.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AFFORDANCE_SIZE_PX,
  CARET_GAP,
  CARET_OVERLAP_FRACTION,
  DOUBLE_TAP_MS,
  DRAG_SLOP_PX,
  NODE_H,
  NODE_W,
} from "./tree-constants";
// The layout module RE-EXPORTS the geometry primitives. Importing them from there proves the single
// source of truth: if a copy is re-introduced, these bindings would diverge.
import { CARET_GAP as LAYOUT_CARET_GAP, NODE_H as LAYOUT_NODE_H, NODE_W as LAYOUT_NODE_W } from "./tree-layout";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("tree geometry is single-sourced", () => {
  it("tree-layout re-exports the SAME NODE_W/NODE_H/CARET_GAP as tree-constants", () => {
    expect(LAYOUT_NODE_W).toBe(NODE_W);
    expect(LAYOUT_NODE_H).toBe(NODE_H);
    expect(LAYOUT_CARET_GAP).toBe(CARET_GAP);
  });

  it("no tree module re-declares a geometry constant outside tree-constants.ts", () => {
    // The P0 bug was a second `export const NODE_W = 150` in person-node.tsx. Fail if any tree source
    // file (other than tree-constants.ts) DECLARES one of these — re-exports (`export { NODE_W }`) and
    // imports are fine; only fresh `const NAME =` declarations are the hazard.
    const GEOMETRY = ["NODE_W", "NODE_H", "CARET_GAP", "AFFORDANCE_SIZE_PX"];
    const declRe = new RegExp(`(?:^|\\s)(?:export\\s+)?const\\s+(${GEOMETRY.join("|")})\\s*=`, "m");
    const offenders: string[] = [];
    for (const file of readdirSync(HERE)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      if (file === "tree-constants.ts" || file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const src = readFileSync(join(HERE, file), "utf8");
      const m = declRe.exec(src);
      if (m) offenders.push(`${file} declares ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("affordance/card overlap is derived, not hand-tuned", () => {
  it("CARET_GAP is derived from the affordance size and overlap fraction", () => {
    // overlap_px   = AFFORDANCE_SIZE_PX/2 − CARET_GAP
    // overlap_frac = overlap_px / AFFORDANCE_SIZE_PX  === CARET_OVERLAP_FRACTION
    const overlapPx = AFFORDANCE_SIZE_PX / 2 - CARET_GAP;
    expect(overlapPx / AFFORDANCE_SIZE_PX).toBeCloseTo(CARET_OVERLAP_FRACTION, 10);
  });

  it("preserves the documented values (30px glyph, 35% bite → 4.5px gap)", () => {
    expect(AFFORDANCE_SIZE_PX).toBe(30);
    expect(CARET_OVERLAP_FRACTION).toBe(0.35);
    // 30·(0.5−0.35) = 4.5 in exact math; float gives 4.5000…01, so compare with tolerance.
    expect(CARET_GAP).toBeCloseTo(4.5, 10);
  });
});

describe("gesture timing knobs (tree Slice A)", () => {
  it("DOUBLE_TAP_MS is a sane positive window, comfortably larger than a single tap", () => {
    expect(DOUBLE_TAP_MS).toBe(300);
    expect(DOUBLE_TAP_MS).toBeGreaterThan(0);
  });

  it("DRAG_SLOP_PX stays the tap/drag threshold", () => {
    expect(DRAG_SLOP_PX).toBe(6);
  });
});
