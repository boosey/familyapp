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

// The pairs every skin must satisfy. `--accent-on` is the shared text/icon colour placed on BOTH
// `--accent` (button base) and `--accent-strong` (button hover) — both must pass. `--accent-strong`
// is ALSO used as text/icons directly on light surfaces (~40 call sites), so it must pass on card+page.
const SURFACE_TEXT_PAIRS = [
  ["--text-body", "--surface-card"],
  ["--text-body", "--surface-page"],
  ["--accent-on", "--accent-strong"], // primary-button HOVER (bg=accent-strong, text=accent-on)
  ["--accent-strong", "--surface-card"], // accent-strong AS text on light surfaces
  ["--accent-strong", "--surface-page"],
] as const;

const STICKER_PAIRS = [
  ["--sticker-coral-ink", "--sticker-coral-bg"],
  ["--sticker-sky-ink", "--sticker-sky-bg"],
  ["--sticker-leaf-ink", "--sticker-leaf-bg"],
  ["--sticker-gold-ink", "--sticker-gold-bg"],
  ["--text-body", "--highlighter"],
] as const;

function assertAA(css: string, fg: string, bg: string): void {
  const ratio = contrast(tokenHex(css, fg), tokenHex(css, bg));
  expect(ratio, `${fg} on ${bg} was ${ratio.toFixed(2)}:1 (need >= ${AA})`).toBeGreaterThanOrEqual(AA);
}

describe("skin contrast (WCAG AA)", () => {
  for (const [name, css] of [["playful", playful], ["heirloom", heirloom]] as const) {
    it(`${name}: text/accent pairs on surfaces meet AA`, () => {
      for (const [fg, bg] of SURFACE_TEXT_PAIRS) assertAA(css, fg, bg);
    });
  }

  for (const [name, css] of [["playful", playful], ["heirloom", heirloom]] as const) {
    it(`${name}: sticker tags + highlighter meet AA`, () => {
      for (const [fg, bg] of STICKER_PAIRS) assertAA(css, fg, bg);
    });
  }

  it("playful: text/icons on the accent (button base) meet AA", () => {
    // This is the pair the original bug shipped wrong (white on bright coral = 2.77:1). Playful now
    // uses white on a deeper coral (#CC4A22 = 4.60:1). NOT asserted for heirloom, whose white-on-
    // terracotta is a PRE-EXISTING 4.44:1 (a hair under AA) that this change does not touch.
    assertAA(playful, "--accent-on", "--accent");
  });
});
