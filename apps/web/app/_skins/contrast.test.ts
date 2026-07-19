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
// Playful's accent is BRIGHT CORAL by owner decision (approved "Playful & warm" mockup, 2026-07-17):
// white on #EF7A54 is 2.77:1, below AA, and that is the intended brand look ("i want the brighter
// colors, that is exactly why we started this"). So the bright-coral + candy-sticker pairs are NOT
// held to AA — only to a legibility FLOOR that still trips a truly-invisible regression. Body reading
// text and the solemn-tone fallback stay AA-guarded on every skin.
const BRAND_FLOOR = 2.6;

// Reading text that MUST meet AA on every skin (prose, and titles sitting on the highlighter wash).
const BODY_TEXT_PAIRS = [
  ["--text-body", "--surface-card"],
  ["--text-body", "--surface-page"],
  ["--text-body", "--highlighter"],
] as const;

// Error/validation text (--text-danger) MUST meet AA on both card and page surfaces on every skin.
// This is the regression guard for the bug where --text-danger was undefined and a hardcoded #b00
// fallback always rendered (off-palette, non-reskinning). Defining the token AND holding it to AA
// here means the dull-red fallback can never silently come back.
const DANGER_TEXT_PAIRS = [
  ["--text-danger", "--surface-card"],
  ["--text-danger", "--surface-page"],
] as const;

// Heirloom is the AA-safe skin; keep its accent pairs held to AA (its coral is the darker terracotta).
const HEIRLOOM_ACCENT_PAIRS = [
  ["--accent-on", "--accent-strong"],
  ["--accent-strong", "--surface-card"],
  ["--accent-strong", "--surface-page"],
] as const;

// Playful's intentional brand pairs — bright coral fills + candy stickers. Below AA by design; guarded
// only against total illegibility. If any of these ever needs strict AA, that's a design decision, not
// a silent token drift.
const PLAYFUL_BRAND_PAIRS = [
  ["--accent-on", "--accent"], // white on bright coral button (2.77:1 — brand)
  ["--accent-on", "--accent-strong"], // white on deeper coral (hover)
  ["--accent-strong", "--surface-card"], // accent-coloured text on light
  ["--sticker-coral-ink", "--sticker-coral-bg"],
  ["--sticker-sky-ink", "--sticker-sky-bg"],
  ["--sticker-leaf-ink", "--sticker-leaf-bg"],
  ["--sticker-gold-ink", "--sticker-gold-bg"],
] as const;

// Under `[data-tone="solemn"]` the decorative palette collapses (globals.css): sticker bg/ink and the
// highlighter fall back to `--surface-sunken` + `--text-meta`, which still renders tag TEXT — guard it.
const SOLEMN_FALLBACK_PAIRS = [["--text-meta", "--surface-sunken"]] as const;

function assertAA(css: string, fg: string, bg: string): void {
  const ratio = contrast(tokenHex(css, fg), tokenHex(css, bg));
  expect(ratio, `${fg} on ${bg} was ${ratio.toFixed(2)}:1 (need >= ${AA})`).toBeGreaterThanOrEqual(AA);
}

describe("skin contrast", () => {
  for (const [name, css] of [["playful", playful], ["heirloom", heirloom]] as const) {
    it(`${name}: body reading text meets AA`, () => {
      for (const [fg, bg] of BODY_TEXT_PAIRS) assertAA(css, fg, bg);
    });
    it(`${name}: solemn-tone fallback text stays legible (AA)`, () => {
      for (const [fg, bg] of SOLEMN_FALLBACK_PAIRS) assertAA(css, fg, bg);
    });
    it(`${name}: danger/error text meets AA`, () => {
      for (const [fg, bg] of DANGER_TEXT_PAIRS) assertAA(css, fg, bg);
    });
  }

  it("heirloom: accent pairs meet AA", () => {
    for (const [fg, bg] of HEIRLOOM_ACCENT_PAIRS) assertAA(heirloom, fg, bg);
  });

  it("playful: bright brand pairs stay above the legibility floor (below AA by owner choice)", () => {
    for (const [fg, bg] of PLAYFUL_BRAND_PAIRS) {
      const ratio = contrast(tokenHex(playful, fg), tokenHex(playful, bg));
      expect(
        ratio,
        `${fg} on ${bg} was ${ratio.toFixed(2)}:1 (brand pair; need >= ${BRAND_FLOOR})`,
      ).toBeGreaterThanOrEqual(BRAND_FLOOR);
    }
  });
});
