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
 * Files permitted to import the GUARDED content tables (`stories`/`media`/`family_photos`/
 * `story_images` via @chronicle/db/content). This is the entire audited surface — every line that
 * can read OR write Story/Media/album/accompaniment content. Keep it small; add a new entry only
 * for a deliberate, reviewed content read/write path.
 */
const ALLOWLIST = new Set<string>([
  "packages/core/src/authorization.ts", // the single read front door
  "packages/core/src/story-repository.ts", // the single write path
  "packages/core/src/intake-answer-repository.ts", // audited intake media + answer writes
  "packages/core/src/album-repository.ts", // audited album (family_photos) read + write (ADR-0009)
  "packages/core/src/story-image-repository.ts", // audited story_images attach/read (ADR-0009 Ph2)
  "packages/core/src/erasure-repository.ts", // audited hard-delete/erasure path (ADR-0008)
  "packages/core/src/story-shared-pings.ts", // loop-event ping recipient metadata (#270 / C13b)
]);

/**
 * The pipeline orchestrator needs a system-actor read of story+canonical-recording metadata to
 * do its job. That helper (`getStoryAndRecordingForPipeline`) lives in `story-repository.ts`
 * (already audited above) and is re-exported only via the `@chronicle/core/pipeline` subpath.
 * This second guard pins the EXACT set of files that may import that subpath — preventing any
 * future `apps/web` route from importing the same helpers and silently bypassing the
 * authorization function. Same exact-membership canary discipline as the content-tables allowlist.
 */
const PIPELINE_HELPER_ALLOWLIST = new Set<string>([
  "packages/pipeline/src/orchestrator.ts",
  "packages/pipeline/src/multi-take.ts",
  "packages/pipeline/src/reap-orphaned-photos.ts", // the #90 reaper's referenced-keys read
]);

/**
 * Kinship (ADR-0016) is a SECOND authorized surface, parallel to the Story front door and NOT part
 * of it. The guarded kinship edge tables (`kinship_assertions`, `kinship_subject_hides`) are
 * reachable ONLY via `@chronicle/db/kinship`, and ONLY from this allowlist — every kinship read/write
 * must route through `@chronicle/core`'s kinship-repository. This is deliberately DISTINCT from the
 * content ALLOWLIST above: a content file may not touch kinship, and the kinship file may not touch
 * content. Keep it small; add an entry only for a deliberate, reviewed kinship read/write path.
 */
const KINSHIP_ALLOWLIST = new Set<string>([
  "packages/core/src/kinship-repository.ts", // the single kinship read surface
  "packages/core/src/kinship-write.ts", // the kinship write path (addRelative, #32)
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
    re: /\.query\.(stories|media|proseRevisions|storyRecordings|familyPhotos|familyPhotoFamilies|storyImages|storyFavorites|storyLikes|photoSubjects|photoPeople|places|photoPlaces)\b/,
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
      "packages/pipeline/src/multi-take.ts",
      "packages/pipeline/src/orchestrator.ts",
      "packages/pipeline/src/reap-orphaned-photos.ts",
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
        "packages/core/src/intake-answer-repository.ts",
        "packages/core/src/album-repository.ts",
        "packages/core/src/story-image-repository.ts",
        "packages/core/src/erasure-repository.ts",
        "packages/core/src/story-shared-pings.ts",
      ].sort(),
    );
  });

  it("only the audited kinship file imports the guarded kinship tables", () => {
    // The kinship edge tables are a distinct guarded surface (ADR-0016). Every production file that
    // imports @chronicle/db/kinship — outside KINSHIP_ALLOWLIST — is a bypass of kinship's own
    // authorization function, exactly as the content scan guards Story/Media.
    const offenders: string[] = [];
    const scanRoots = ["packages", "apps"].map((d) => join(repoRoot, d));
    const KINSHIP_IMPORT = /@chronicle\/db\/kinship/;

    for (const root of scanRoots) {
      for (const file of collectSourceFiles(root)) {
        const rel = toPosix(relative(repoRoot, file));
        if (/\/(test|__tests__)\//.test(rel)) continue;
        if (/\.(config)\.[cm]?tsx?$/.test(rel)) continue;
        if (rel.endsWith("-env.d.ts")) continue;
        if (rel.startsWith("packages/db/")) continue; // the table definitions live here
        if (KINSHIP_ALLOWLIST.has(rel)) continue;
        const contents = readFileSync(file, "utf8");
        if (KINSHIP_IMPORT.test(contents)) {
          offenders.push(
            `${rel} — imports the guarded kinship tables via @chronicle/db/kinship`,
          );
        }
      }
    }

    expect(
      offenders,
      `These files reach the guarded kinship tables but are not on the kinship allowlist. Route ` +
        `kinship reads/writes through @chronicle/core's kinship-repository; for a legitimate new ` +
        `path, add the file to KINSHIP_ALLOWLIST in this test deliberately.\nOffenders: ` +
        JSON.stringify(offenders, null, 2),
    ).toEqual([]);
  });

  it("the kinship allowlist is exactly the audited surface (canary)", () => {
    expect([...KINSHIP_ALLOWLIST].sort()).toEqual([
      "packages/core/src/kinship-repository.ts",
      "packages/core/src/kinship-write.ts",
    ]);
  });

  it("the runtime client does NOT expose Drizzle's relational API for content tables", async () => {
    const db = await createTestDatabase();
    // If schema were registered on the client, `db.query.stories.findMany()` would read content
    // with no table import and no authorization check. Drizzle leaves `db.query` as an empty
    // object when no schema is registered, so the content accessors must be absent.
    const query = (db as unknown as { query: Record<string, unknown> }).query;
    expect(query.stories).toBeUndefined();
    expect(query.media).toBeUndefined();
    expect(query.storyFavorites).toBeUndefined();
    expect(query.storyLikes).toBeUndefined();
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
