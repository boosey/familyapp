/**
 * Architecture guard — the single front door, enforced as a build-failing test.
 *
 * The spec's central Phase-0 rule: "There is no query path that returns story content while
 * bypassing [the authorization] function." In a TypeScript monorepo the structural lock is: the
 * raw content tables (`stories`, `media`) may only be imported via `@chronicle/db/schema`, and
 * only by an AUDITED allowlist of files. Every other source file must reach story/media content
 * through `@chronicle/core`'s read helpers. This test scans the source tree and fails if anyone
 * imports the schema subpath outside the allowlist — so a future bypass cannot land silently.
 *
 * When a new write path legitimately needs the tables, add it here deliberately; that keeps the
 * set of files touching content tables small and auditable.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase } from "@chronicle/db";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Files permitted to import the raw content tables. Audited surface — keep it small. */
const ALLOWLIST = new Set<string>([
  "packages/core/src/authorization.ts",
  "packages/core/src/consent.ts",
]);

/**
 * Every known way to reach Story/Media content outside the authorization function. Each closed
 * either by a code change or matched here:
 *   - importing the raw tables via the guarded subpath;
 *   - importing the low-level client subpath (removed from package exports, flagged if re-added);
 *   - the Drizzle relational API on a content table (disabled by not registering schema, but
 *     flagged in case anyone re-registers it).
 * Residual, deliberately out of scope: hand-written raw SQL via db.execute(sql`...`). That is an
 * overt bypass that code review catches; no string guard can reliably distinguish it.
 */
const FORBIDDEN: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /@chronicle\/db\/schema/, label: "imports raw content tables via @chronicle/db/schema" },
  { re: /@chronicle\/db\/client/, label: "imports the low-level @chronicle/db/client subpath" },
  {
    re: /\.query\.(stories|media)\b/,
    label: "uses the Drizzle relational API on a content table (db.query.*)",
  },
];

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name === ".next" ||
        e.name === "drizzle"
      ) {
        continue;
      }
      collectSourceFiles(full, acc);
    } else if (
      /\.(ts|tsx)$/.test(e.name) &&
      !/\.test\.tsx?$/.test(e.name) &&
      !e.name.endsWith(".d.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

describe("single front door (architecture guard)", () => {
  it("only audited files import the raw content tables", () => {
    // Scan every package's src EXCEPT the db package itself (which defines the tables) and
    // except test files (tests legitimately seed via the schema).
    const offenders: string[] = [];
    const scanRoots = ["packages", "apps"].map((d) => join(repoRoot, d));

    for (const root of scanRoots) {
      for (const file of collectSourceFiles(root)) {
        const rel = toPosix(relative(repoRoot, file));
        // Only production source counts. Tests legitimately seed via the schema; package-root
        // config files (vitest/drizzle) are not application code.
        if (!rel.includes("/src/")) continue;
        if (rel.startsWith("packages/db/")) continue; // the table definitions live here
        if (ALLOWLIST.has(rel)) continue;
        const contents = readFileSync(file, "utf8");
        for (const { re, label } of FORBIDDEN) {
          if (re.test(contents)) offenders.push(`${rel} — ${label}`);
        }
      }
    }

    expect(
      offenders,
      `These files import @chronicle/db/schema (the raw content tables) but are not on the ` +
        `audited allowlist. Either route story/media reads through @chronicle/core, or, if this ` +
        `is a legitimate write path, add it to ALLOWLIST in this test deliberately.\nOffenders: ` +
        JSON.stringify(offenders, null, 2),
    ).toEqual([]);
  });

  it("the allowlist itself stays small and auditable", () => {
    // A canary: if this grows unexpectedly, someone widened the trusted surface.
    expect(ALLOWLIST.size).toBeLessThanOrEqual(8);
  });

  it("the runtime client does NOT expose Drizzle's relational API for content tables", async () => {
    const db = await createTestDatabase();
    // If schema were registered on the client, `db.query.stories.findMany()` would read content
    // with no table import and no authorization check. Drizzle leaves `db.query` as an empty
    // object when no schema is registered, so the content accessors must be absent.
    const query = (db as unknown as { query: Record<string, unknown> }).query;
    expect(query.stories).toBeUndefined();
    expect(query.media).toBeUndefined();
  });
});
