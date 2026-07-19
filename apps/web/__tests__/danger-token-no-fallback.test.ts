/**
 * Arch-style scan guard for issue #211.
 *
 * `--text-danger` is defined in the base tokens (`_kindred/tokens.css`) and overridden per skin
 * (`_skins/playful.css`), so a call site must consume it as `var(--text-danger)` — WITHOUT a hex
 * fallback. A fallback (`var(--text-danger, #b00)`) is dead code at best, and at worst it silently
 * renders an off-palette red when someone typos the token name, hiding the mistake instead of
 * failing visibly. This test walks the app source and asserts no danger-token fallback survives.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "app");

/** Recursively collect every .ts/.tsx/.css file under `dir` (skips node_modules/.next). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

/** Matches a danger-token var() with ANY fallback, e.g. `var(--text-danger, #b00)`. */
const DANGER_FALLBACK = /var\(\s*--[\w-]*danger[\w-]*\s*,/i;

describe("no danger-token hex fallbacks in app source", () => {
  const files = walk(appDir);

  it("finds source files to check (guards against a broken glob)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no var(--…danger…, <fallback>) survives — the token is always defined", () => {
    const offenders = files.filter((abs) => DANGER_FALLBACK.test(readFileSync(abs, "utf8")));
    expect(
      offenders,
      `danger-token fallbacks found (strip to bare var(--…danger)):\n${offenders
        .map((f) => relative(appDir, f))
        .join("\n")}`,
    ).toEqual([]);
  });
});
