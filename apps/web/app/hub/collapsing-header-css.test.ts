/**
 * ADR-0025 mobile Phase B, Increment 2 — CSS contract regression guards for the collapse-on-scroll
 * header. String-scans page.module.css on disk (the CSS-module import is a class-name proxy, not text)
 * to bond the facts that only manifest on a real scrolling phone:
 *  (a) the band is `position: sticky; top: 0` (stays in flow → no content offset) and hides via a
 *      transform (NOT display:none, so it re-reveals and stays in the a11y tree);
 *  (b) the slide is suppressed under reduced motion (both the OS query and the data-attribute switch).
 * Coarse on purpose, matching bottom-tab-bar-css.test.ts / responsive-breakpoints.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, "page.module.css"), "utf8");

/** Extract a class rule block (`.name { … }`) for coarse presence assertions. */
function ruleBlock(selector: string): string {
  const open = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`);
  const m = open.exec(css);
  if (!m) return "";
  const end = css.indexOf("}", m.index);
  return end === -1 ? css.slice(m.index) : css.slice(m.index, end + 1);
}

describe("CollapsingHeader CSS contract (regression)", () => {
  it("the sticky header pins at the top and hides via transform (not display:none)", () => {
    const sticky = ruleBlock(".headerSticky");
    expect(sticky).toContain("position: sticky");
    expect(sticky).toContain("top: 0");
    // The hide is a transform, so the header re-reveals and never leaves the a11y tree.
    expect(ruleBlock(".headerHidden")).toContain("transform: translateY(-100%)");
  });

  it("suppresses the slide under reduced motion (OS query + data-attribute switch)", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain('[data-reduce-motion="on"]');
    // BOTH reduced-motion paths must actually zero the transition on the sticky header — assert the
    // rule body, not just that the selector exists (a selector with no `transition: none` is a silent
    // regression the coarse presence check would miss).
    const reduceOsLayer = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduceOsLayer).toContain("transition: none");
    const reduceAttrRule = css.slice(css.indexOf('[data-reduce-motion="on"]'));
    expect(reduceAttrRule.slice(0, reduceAttrRule.indexOf("}") + 1)).toContain("transition: none");
  });
});
