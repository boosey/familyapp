/**
 * ADR-0025 Phase B, Increment 3 — CSS contract guards for the SHARED HubControlStrip layout (used by
 * Stories, Album, later Family). String-scans the CSS on disk (the module import is a class-name proxy)
 * to bond the two facts that only manifest on a real phone:
 *  the ONE-row shrink valve — `.strip` is `nowrap`, `.pills` is `flex: 1 1 auto; min-width: 0` (absorbs
 *  the deficit), and `.right` is `flex: 0 0 auto` + `nowrap` (never shrinks/wraps, stays intact). There
 *  is NO avatar clearance — the account avatar moved into the bottom nav bar (#233), so the strip has no
 *  top-right element to clear. Coarse on purpose, matching the other *-css.test.ts guards.
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
  it("is a ONE-row strip: pills are the shrink valve, the icon cluster never shrinks", () => {
    // One row — the strip does not wrap (the account avatar moved to the bottom bar, so no clearance
    // pushes the cluster onto a second line).
    expect(ruleBlock(".strip")).toContain("flex-wrap: nowrap");
    const pills = ruleBlock(".pills");
    expect(pills).toContain("flex: 1 1 auto");
    expect(pills).toContain("min-width: 0");
    const right = ruleBlock(".right");
    expect(right).toContain("flex: 0 0 auto");
    expect(right).toContain("flex-wrap: nowrap");
  });

  it("reserves NO account-avatar clearance (avatar moved into the bottom bar, #233)", () => {
    expect(ruleBlock(".right")).not.toContain("--mobile-account-clearance");
  });
});
