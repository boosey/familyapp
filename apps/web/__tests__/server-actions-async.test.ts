/**
 * Regression: every export of a module-level `"use server"` file must be an async function.
 *
 * Next.js enforces this at BUILD time only (an SWC/webpack check) — `tsc` and vitest are both
 * blind to it, so a non-async server-action export (e.g. `export function fooAction(): Promise<T>`)
 * type-checks and unit-tests clean, then fails the production `next build` with
 * "Server Actions must be async functions." That is exactly what broke the deploy of 695e68a:
 * four delegating tag/untag actions in app/hub/album/actions.ts were `export function`, not
 * `export async function`.
 *
 * This scanner reproduces the rule cheaply so the class of bug is caught by `pnpm test`, before a
 * push ever reaches Vercel. It flags any exported NON-async function in a top-level "use server"
 * module: plain `export function`, `export default function`, or an `export const x = (...) =>`
 * arrow that isn't `async`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..", "app");

/** Recursively collect every .ts/.tsx file under `dir` (skips node_modules/.next). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (/\.tsx?$/.test(entry.name)) out.push(abs);
  }
  return out;
}

/** True when the module's FIRST executable statement is a `"use server"` directive (module scope). */
function isModuleLevelUseServer(source: string): boolean {
  // Strip a leading run of blank lines / line- and block-comments, then look at the first token.
  let s = source;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const trimmed = s.replace(/^\s+/, "");
    if (trimmed.startsWith("//")) {
      s = trimmed.slice(trimmed.indexOf("\n") + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      s = trimmed.slice(trimmed.indexOf("*/") + 2);
      continue;
    }
    return /^["']use server["']\s*;?/.test(trimmed);
  }
}

/** Return the labels of any exported non-async functions (the Next.js build would reject). */
function nonAsyncExportedFunctions(source: string): string[] {
  const offenders: string[] = [];
  // `export function foo` / `export default function foo` — but NOT `export async function`.
  const fnRe = /^export\s+(?:default\s+)?function\b/gm;
  for (const m of source.matchAll(fnRe)) {
    // Look back for an `async` between `export` and `function` on the same match.
    if (!/^export\s+(?:default\s+)?async\s+function\b/.test(m[0])) {
      const line = source.slice(0, m.index).split("\n").length;
      offenders.push(`line ${line}: ${m[0].trim()}`);
    }
  }
  // `export const foo = (...) => ...` / `= function ...` that is not async.
  const constRe = /^export\s+const\s+(\w+)\s*=\s*(async\s+)?(\([^)]*\)\s*(?::[^=]+)?=>|function\b)/gm;
  for (const m of source.matchAll(constRe)) {
    if (!m[2]) {
      const line = source.slice(0, m.index).split("\n").length;
      offenders.push(`line ${line}: export const ${m[1]} = (non-async fn)`);
    }
  }
  return offenders;
}

describe("'use server' modules export only async functions", () => {
  const files = walk(appDir).filter((abs) => isModuleLevelUseServer(readFileSync(abs, "utf8")));

  it("finds server-action modules to check (guards against a broken glob)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const abs of files) {
    it(`${relative(appDir, abs)} — all exported functions are async`, () => {
      const offenders = nonAsyncExportedFunctions(readFileSync(abs, "utf8"));
      expect(offenders, `non-async exports (Next.js build would reject):\n${offenders.join("\n")}`).toEqual([]);
    });
  }
});
