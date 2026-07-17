// Regression guard for the Playful accent contrast fix.
//
// The first cut shipped `--accent-on: #FFFFFF` on `--accent: #EF7A54` — white on bright coral is
// 2.77:1, which fails WCAG AA (below even the 3.0 large-text bar). This test parses the skin token
// files, resolves each colour (following one level of `var(--x)`), computes the WCAG contrast ratio,
// and asserts the text/accent pairs meet AA — so the failing combination can never come back silently.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");
const playful = read("./playful.css");
const heirloom = read("../_kindred/tokens.css"); // heirloom = the base/default skin (see tokens.css)

/** First declared value of a CSS custom property, resolving one level of `var(--x)` to a hex. */
function tokenHex(css: string, name: string): string {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`);
  const m = css.match(re);
  if (!m) throw new Error(`token ${name} not found`);
  const raw = m[1]!.trim();
  const ref = raw.match(/var\(\s*(--[\w-]+)\s*\)/);
  if (ref) return tokenHex(css, ref[1]!);
  const hex = raw.match(/#[0-9a-fA-F]{6}/);
  if (!hex) throw new Error(`token ${name} is not a 6-digit hex or var(): "${raw}"`);
  return hex[0];
}

/** WCAG relative luminance of a #rrggbb hex. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const chan = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0]! + 0.7152 * chan[1]! + 0.0722 * chan[2]!;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)];
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

describe("skin contrast (WCAG AA)", () => {
  it("playful: body text on card + page surfaces meets AA", () => {
    expect(contrast(tokenHex(playful, "--text-body"), tokenHex(playful, "--surface-card"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(tokenHex(playful, "--text-body"), tokenHex(playful, "--surface-page"))).toBeGreaterThanOrEqual(AA);
  });

  it("playful: text/icons on the accent meet AA (fix: dark ink on coral, not white)", () => {
    const ratio = contrast(tokenHex(playful, "--accent-on"), tokenHex(playful, "--accent"));
    expect(ratio, `--accent-on on --accent was ${ratio.toFixed(2)}:1 (need >= ${AA})`).toBeGreaterThanOrEqual(AA);
  });

  it("heirloom: body text on card + page surfaces meets AA", () => {
    expect(contrast(tokenHex(heirloom, "--text-body"), tokenHex(heirloom, "--surface-card"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(tokenHex(heirloom, "--text-body"), tokenHex(heirloom, "--surface-page"))).toBeGreaterThanOrEqual(AA);
  });

  // NOTE: heirloom's white-on-terracotta accent is a PRE-EXISTING 4.44:1 (a hair under AA). It is
  // intentionally NOT asserted here — this change does not touch heirloom's palette. Tracked separately.
});
