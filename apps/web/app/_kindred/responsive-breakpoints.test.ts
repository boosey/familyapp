// Guard: every width-based @media layer under apps/web/app must use ONE of the canonical breakpoints.
//
// The web app is mobile-first and intrinsically responsive (clamp/auto-fill/flex-wrap); a width
// breakpoint is a last resort. RESPONSIVE_BREAKPOINTS_REM in lib/constants.ts is the single source of
// truth. Test (A) scans the CSS tree and fails if any `@media (min-width: …)` uses an off-grid value.
// Test (B) bonds the specific /s narrator heading fix (fluid clamp + wrap) so it can't regress to a
// flat px size.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { RESPONSIVE_BREAKPOINTS_REM } from "@/lib/constants";

// _kindred sits directly under app/, so its parent is the app dir.
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** All `*.css` files under `dir`, recursively. */
function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

/**
 * Extract the rule block for a class `selector` (from the selector to its closing `}`). Anchors on
 * the selector FOLLOWED BY its opening brace (`.hello {` / `.hello{`) rather than the bare string, so
 * a prefix collision (e.g. a later `.helloBox`) can never make this silently return the wrong block —
 * which would turn the regression assertion below into an invisible false pass.
 */
function ruleBlock(css: string, selector: string): string {
  const open = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`);
  const m = open.exec(css);
  if (!m) return "";
  const start = m.index;
  const end = css.indexOf("}", start);
  return end === -1 ? css.slice(start) : css.slice(start, end + 1);
}

describe("responsive breakpoints are single-sourced", () => {
  it("no @media uses an off-grid min-width", () => {
    const allowed = new Set<number>(Object.values(RESPONSIVE_BREAKPOINTS_REM));
    // Only min-width inside an `@media` prelude counts as a breakpoint — a bare `min-width:` property
    // on an element (e.g. a badge) is not a responsive layer and must not be flagged.
    // KNOWN GAP: this matches the classic `min-width:` form only. CSS Media Queries Level 4 range
    // syntax — `@media (640px <= width)` — is NOT detected. It is unused in this tree (grep confirms
    // zero width `@media` today) and off-convention here; if it is ever adopted, extend this scan.
    const atMediaRe = /@media[^{]*/g;
    const minWidthRe = /min-width:\s*([\d.]+)(px|rem)/g;
    const offenders: string[] = [];
    for (const file of cssFiles(APP_DIR)) {
      const css = readFileSync(file, "utf8");
      let prelude: RegExpExecArray | null;
      while ((prelude = atMediaRe.exec(css)) !== null) {
        let m: RegExpExecArray | null;
        minWidthRe.lastIndex = 0;
        while ((m = minWidthRe.exec(prelude[0])) !== null) {
          const value = m[2] === "px" ? Number(m[1]) / 16 : Number(m[1]);
          if (!allowed.has(value)) offenders.push(`${file}:${m[1]}${m[2]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the /s narrator display headings stay fluid + wrap (regression)", () => {
    const css = readFileSync(join(APP_DIR, "s", "[token]", "capture.module.css"), "utf8");
    for (const selector of [".hello", ".restingTitle"]) {
      const block = ruleBlock(css, selector);
      expect(block).toContain("clamp(");
      expect(block).toContain("overflow-wrap");
    }
  });
});

// ADR-0024 mobile pass regressions. The three shared primitives are mobile-first (base = phone,
// desktop re-layered at `min-width: 40rem`). These string-scan bonds fail if a base rule silently
// reverts to the old desktop-first shape — the exact regression the pass fixed. Kept deliberately
// coarse (presence of the load-bearing declaration in the right block), not pixel-exact.
describe("ADR-0024 mobile-first layout is single-sourced (regression)", () => {
  it("HubToolbar row is a stacked column at base and a row only at ≥ sm", () => {
    const css = readFileSync(join(APP_DIR, "hub", "HubToolbar.module.css"), "utf8");
    // Base `.row` must stack (mobile-first). A regression to desktop-first would set row here.
    expect(ruleBlock(css, ".row")).toContain("flex-direction: column");
    // The horizontal row is restored inside the sm layer, not at base.
    const smLayer = css.slice(css.indexOf("@media (min-width: 40rem)"));
    expect(smLayer).toContain("flex-direction: row");
  });

  it("SegmentedControl group is full-width at base and never wraps at ≥ sm", () => {
    const css = readFileSync(join(APP_DIR, "_kindred", "SegmentedControl.module.css"), "utf8");
    // Base `.group` claims the full row (mobile-first equal segments).
    expect(ruleBlock(css, ".group")).toContain("width: 100%");
    // The sm layer must re-assert `nowrap` so an intrinsic-width desktop pill box can't drop a
    // second row (the Round-A cold-review fix).
    const smLayer = css.slice(css.indexOf("@media (min-width: 40rem)"));
    expect(smLayer).toContain("flex-wrap: nowrap");
  });

  it("ModalShell surface keeps the cap + scroll + safe-area contract", () => {
    const css = readFileSync(join(APP_DIR, "_kindred", "ModalShell.module.css"), "utf8");
    const surface = ruleBlock(css, ".surface");
    expect(surface).toContain("max-height");
    expect(surface).toContain("overflow-y: auto");
    // The overlay carries the safe-area insets so a full-bleed phone dialog clears the notch/home bar.
    expect(css).toContain("env(safe-area-inset-top)");
  });
});
