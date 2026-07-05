import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the Vercel build break in dpl_CXgAzKP4bfWEmjzUCuHAZU73kS3s
 * (commit ee36b08 added `export { AccountMenuMount }` to app/_kindred/index.ts).
 *
 * The _kindred barrel is imported by CLIENT components (e.g. CreateFamilyForm pulling
 * in KindredButton). A barrel import drags in EVERY re-exported module, so if any of
 * them is `import "server-only"` the whole client bundle fails to compile:
 *   "You're importing a component that needs 'server-only' ... one of its parents is
 *    marked with 'use client'".
 *
 * This test scans every module re-exported from the barrel and fails if any of them
 * declares `server-only`. Server-only helpers (like AccountMenuMount) must be imported
 * directly from their own module by server components, never surfaced through this barrel.
 */
const barrelDir = dirname(fileURLToPath(import.meta.url));
const kindredDir = join(barrelDir, "..", "app", "_kindred");
const barrelPath = join(kindredDir, "index.ts");

describe("_kindred barrel stays client-safe", () => {
  it("re-exports no server-only module", () => {
    const barrel = readFileSync(barrelPath, "utf8");
    // Collect relative module specifiers from `export ... from "./X"` statements
    // (anchored to `export` so prose in comments referencing `from "./X"` is ignored).
    const specifiers = [
      ...barrel.matchAll(/^\s*export\b[^\n]*?\bfrom\s+["']\.\/([^"']+)["']/gm),
    ].map((m) => m[1]!);
    expect(specifiers.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const spec of specifiers) {
      let source: string | undefined;
      for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        try {
          source = readFileSync(join(kindredDir, spec + ext), "utf8");
          break;
        } catch {
          // try next extension
        }
      }
      if (source && /import\s+["']server-only["']/.test(source)) {
        offenders.push(spec);
      }
    }

    expect(
      offenders,
      `These server-only modules are re-exported from app/_kindred/index.ts and will break ` +
        `any client component importing from the barrel: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
