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

/**
 * Files permitted to import the GUARDED content tables (`stories`/`media` via @chronicle/db/content).
 * This is the entire audited surface — every line that can read OR write Story/Media content.
 * Keep it small; add a new entry only for a deliberate, reviewed content read/write path.
 */
const ALLOWLIST = new Set<string>([
  "packages/core/src/authorization.ts", // the single read front door
  "packages/core/src/story-repository.ts", // the single write path
]);

/**
 * The pipeline orchestrator needs a system-actor read of story+canonical-recording metadata to
 * do its job. That helper (`getStoryAndRecordingForPipeline`) lives in `story-repository.ts`
 * (already audited above) and is re-exported only via the `@chronicle/core/pipeline` subpath.
 * This second guard pins that the subpath is used by exactly one file — preventing any future
 * `apps/web` route from importing the same helper and silently bypassing the authorization
 * function. Same exact-membership canary discipline as the content-tables allowlist.
 */
const PIPELINE_HELPER_ALLOWLIST = new Set<string>([
  "packages/pipeline/src/orchestrator.ts",
]);

/**
 * Every known way to reach Story/Media content outside the authorization function. Each is closed
 * by a code change and/or matched here:
 *   - importing the guarded content tables (@chronicle/db/content);
 *   - importing the low-level client subpath (removed from package exports; flagged if re-added);
 *   - the Drizzle relational API on a content table (disabled by not registering schema; flagged
 *     in case anyone re-registers it).
 * Residual, deliberately out of scope: hand-written raw SQL via db.execute(sql`...`). That is an
 * overt bypass that code review catches; no string guard can reliably distinguish it.
 */
const FORBIDDEN: ReadonlyArray<{ re: RegExp; label: string }> = [
  {
    re: /@chronicle\/db\/content/,
    label: "imports the guarded content tables via @chronicle/db/content",
  },
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
  it("only the pipeline orchestrator imports @chronicle/core/pipeline (system-actor read)", () => {
    const offenders: string[] = [];
    const scanRoots = ["packages", "apps"].map((d) => join(repoRoot, d));
    for (const root of scanRoots) {
      for (const file of collectSourceFiles(root)) {
        const rel = toPosix(relative(repoRoot, file));
        if (/\/(test|__tests__)\//.test(rel)) continue;
        if (/\.(config)\.[cm]?tsx?$/.test(rel)) continue;
        if (rel.endsWith("-env.d.ts")) continue;
        if (rel === "packages/core/src/pipeline.ts") continue; // the subpath itself
        if (PIPELINE_HELPER_ALLOWLIST.has(rel)) continue;
        const contents = readFileSync(file, "utf8");
        // Match only import/from forms — a comment mentioning the path (e.g. the
        // breadcrumb in core/src/index.ts) is fine and shouldn't trip the guard.
        if (/from\s+["']@chronicle\/core\/pipeline["']/.test(contents)) {
          offenders.push(
            `${rel} — imports the system-actor pipeline helper outside the allowlist`,
          );
        }
      }
    }
    expect(
      offenders,
      `getStoryAndRecordingForPipeline is a content-surfacing read without an AuthContext check. ` +
        `Only the pipeline orchestrator may use it; user-facing surfaces must route through ` +
        `@chronicle/core's authorization function instead.\nOffenders: ` +
        JSON.stringify(offenders, null, 2),
    ).toEqual([]);
  });

  it("the pipeline-helper allowlist is exactly the audited surface (canary)", () => {
    expect([...PIPELINE_HELPER_ALLOWLIST].sort()).toEqual([
      "packages/pipeline/src/orchestrator.ts",
    ]);
  });

  it("only audited files import the raw content tables", () => {
    // Scan every package's src EXCEPT the db package itself (which defines the tables) and
    // except test files (tests legitimately seed via the schema).
    const offenders: string[] = [];
    const scanRoots = ["packages", "apps"].map((d) => join(repoRoot, d));

    for (const root of scanRoots) {
      for (const file of collectSourceFiles(root)) {
        const rel = toPosix(relative(repoRoot, file));
        // Scan ALL production code (packages/*/src AND apps/web/app, lib, ...). Skip tests
        // (they legitimately seed via the schema) and config/env files.
        if (/\/(test|__tests__)\//.test(rel)) continue;
        if (/\.(config)\.[cm]?tsx?$/.test(rel)) continue;
        if (rel.endsWith("-env.d.ts")) continue;
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
      `These files reach the guarded content tables (via @chronicle/db/content, the /client ` +
        `subpath, or db.query.{stories,media}) but are not on the audited allowlist. Route ` +
        `story/media reads through @chronicle/core; for a legitimate new write path, add the ` +
        `file to ALLOWLIST in this test deliberately.\nOffenders: ` +
        JSON.stringify(offenders, null, 2),
    ).toEqual([]);
  });

  it("the allowlist itself is exactly the audited surface (canary against quiet widening)", () => {
    // Exact membership, not a ceiling: every addition is a deliberate review event, surfaced as
    // a diff that the reviewer must justify (rather than slipping under a generous upper bound).
    expect([...ALLOWLIST].sort()).toEqual(
      [
        "packages/core/src/authorization.ts",
        "packages/core/src/story-repository.ts",
      ].sort(),
    );
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

  it("db.query.stories / db.query.media are rejected at the TYPE level (compile-time guard)", async () => {
    // Type-level regression test. The runtime test above proves the property is undefined at
    // runtime, but a previous version of `Database` had `PgDatabase<any, any, any>`, which made
    // `db.query` resolve to `any` — so a caller writing `db.query.stories.findMany()` would
    // compile silently and only blow up at runtime. The `Database` type now pins the schema
    // generic to `Record<string, never>`, which causes Drizzle to resolve `query` to a
    // `DrizzleTypeError<...>`. The `@ts-expect-error` lines below MUST produce a real TS error;
    // if anyone widens the schema generic back to `any` or registers a schema on the client,
    // the suppressions go unused and tsc fails the typecheck. That is the regression alarm.
    const db = await createTestDatabase();
    // @ts-expect-error db.query.stories must be structurally unreachable (front-door type guard)
    const _stories = db.query.stories;
    // @ts-expect-error db.query.media must be structurally unreachable (front-door type guard)
    const _media = db.query.media;
    void _stories;
    void _media;
  });
});
