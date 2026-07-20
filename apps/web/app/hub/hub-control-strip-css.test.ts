/**
 * ADR-0025 Phase B, Increment 3 — CSS contract guards for the SHARED HubControlStrip layout (used by
 * Stories, Album, later Family). String-scans the CSS on disk (the module import is a class-name proxy)
 * to bond the two facts that only manifest on a real phone:
 *  (a) the no-collapse contract (#234) — the strip WRAPS, `.pills` has a real (non-zero) `min-width` so
 *      the Feed/Timeline SegmentedControl can't compress into a vertical stack, and `.right` is
 *      `flex: 0 0 auto` (never shrinks/wraps → it wraps to its own line instead);
 *  (b) the account-avatar clearance (#233) — `.right` reserves `--mobile-account-clearance` so the
 *      top-right action never sits under the global fixed avatar.
 * Coarse on purpose, matching the other *-css.test.ts guards.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, "HubControlStrip.module.css"), "utf8");

function ruleBlock(selector: string): string {
  const open = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`);
  const m = open.exec(css);
  if (!m) return "";
  const end = css.indexOf("}", m.index);
  return end === -1 ? css.slice(m.index) : css.slice(m.index, end + 1);
}

describe("HubControlStrip shared CSS contract (regression)", () => {
  it("the strip wraps and the pills keep a real min-width so Feed/Timeline can't collapse (#234)", () => {
    // The strip must wrap so the icon cluster drops to its own line rather than crushing the pills.
    expect(ruleBlock(".strip")).toContain("flex-wrap: wrap");
    const pills = ruleBlock(".pills");
    expect(pills).toContain("flex: 1 1 auto");
    // A REAL min-width floor (the SegmentedControl's natural width) — NOT `min-width: 0`, which let the
    // segments compress into a vertical stack on-device.
    expect(pills).toContain("min-width: var(--strip-pills-min)");
    expect(pills).not.toContain("min-width: 0");
    // The icon cluster never shrinks/wraps internally — it wraps as a whole to the next line instead.
    const right = ruleBlock(".right");
    expect(right).toContain("flex: 0 0 auto");
    expect(right).toContain("flex-wrap: nowrap");
  });

  it("the icon cluster reserves the account-avatar clearance (#233)", () => {
    expect(ruleBlock(".right")).toContain("padding-right: var(--mobile-account-clearance)");
  });
});
