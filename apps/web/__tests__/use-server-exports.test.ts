/**
 * Next.js `"use server"` modules may only export async functions. Exporting a value object
 * (`export const IDLE = {…}`) compiles fine but throws at action invoke time:
 *   "A use server file can only export async functions, found object"
 * which surfaces in PersonInviteModal as "Couldn't load invite options" (#334 regression).
 *
 * This scan keeps that class of bug from landing silently.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webAppRoot = fileURLToPath(new URL("../app", import.meta.url));

/** Top-level value exports that Next.js rejects from `"use server"` files. */
const FORBIDDEN_VALUE_EXPORT =
  /^export\s+(?:const|let|var|class)\b|^export\s+function\s+\w+/gm;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(abs));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
      out.push(abs);
    }
  }
  return out;
}

function isUseServerFile(source: string): boolean {
  // File-level directive only (not a nested `"use server"` inside one action).
  const head = source.slice(0, 500);
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*"use server"\s*;/m.test(head) ||
    source.trimStart().startsWith('"use server"');
}

describe('"use server" files export only async functions', () => {
  it("does not export const/let/var/class/sync-function values", () => {
    const offenders: string[] = [];
    for (const abs of walkTsFiles(webAppRoot)) {
      const source = readFileSync(abs, "utf8");
      if (!isUseServerFile(source)) continue;
      // Strip block comments + type-only exports so `export type` / `export interface` don't trip us.
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*export\s+type\s+.+$/gm, "")
        .replace(/^\s*export\s+interface\s+[\s\S]*?^}/gm, "");
      const matches = stripped.match(FORBIDDEN_VALUE_EXPORT);
      if (matches?.length) {
        offenders.push(
          `${relative(webAppRoot, abs).replace(/\\/g, "/")}: ${matches.map((m) => m.trim()).join("; ")}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
