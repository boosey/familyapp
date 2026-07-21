# Database Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@chronicle/db` a real forward migration path (drizzle-kit chain applied to Neon by `migrate()`), while keeping the existing fast snapshot for tests/dev, bonded by a drift-guard test.

**Architecture:** `schema.ts` stays the single source of truth. It derives TWO artifacts: the existing **snapshot** (`drizzle/schema.sql` + `drizzle/invariants.sql`, applied wholesale — fast path for PGlite tests and the dev seed) and a new **migration chain** (`drizzle/migrations/NNNN_*.sql` + `meta/`, applied incrementally to Neon and tracked in `__drizzle_migrations`). A single drift-guard test asserts the two produce byte-identical databases so they can never silently diverge. Invariants drizzle can't model (triggers, append-only guards, partial unique indexes) are hand-carried into migration files; the drift guard catches omissions.

**Tech Stack:** drizzle-kit 0.30 (`generate`), drizzle-orm 0.38 (`drizzle-orm/postgres-js/migrator`'s `migrate()`), PGlite 0.2.17 (tests), postgres.js (Neon), Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-04-db-migrations-design.md`

---

## File Structure

**Create:**
- `packages/db/drizzle/migrations/0000_baseline.sql` — full current schema + invariants (generated then hand-augmented). The chain's root.
- `packages/db/drizzle/migrations/meta/_journal.json` + `0000_snapshot.json` — drizzle-kit generated journal/snapshot (do not hand-edit).
- `packages/db/src/run-migrations.ts` — `runMigrations(db)`: apply pending migrations to a real Postgres via drizzle's official migrator. Replaces `applySchemaToPostgres`.
- `packages/db/src/migration-fingerprint.ts` — `fullSchemaFingerprint(run)` + `replayMigrationsFromEmpty(pglite)` test/guard helpers.
- `packages/db/test/migration-drift.test.ts` — the drift-guard test (snapshot ≡ chain) + comparator self-test.
- `packages/db/scripts/migrate.ts` — CLI entry (`db:migrate`) run in the Vercel build.

**Modify:**
- `packages/db/drizzle.config.ts` — point `out` at `./drizzle/migrations`.
- `packages/db/scripts/gen-schema.mjs` — after regenerating `schema.sql`, also run `drizzle-kit generate` so one command produces both artifacts.
- `packages/db/package.json` — add `db:migrate`; keep `db:generate`, `db:check-parity`.
- `packages/db/src/index.ts` — export `runMigrations`; drop `applySchemaToPostgres` export (see Task 5).
- `packages/db/src/migrate.ts` — remove/deprecate `applySchemaToPostgres`; update the module doc.
- `packages/db/src/postgres-client.ts` — update the stale "single-schema, no migrations" doc block.
- `apps/web/lib/runtime.ts` — remove the `CHRONICLE_RUN_MIGRATIONS` + `applySchemaToPostgres` boot bootstrap (migrations now run at build).
- `apps/web/vercel.json` — `buildCommand`: run `db:migrate`, then keep `db:check-parity` as a post-migrate assertion, then `next build`.
- `apps/web/__tests__/next-config-db-sql-tracing.test.ts` — drop the `CHRONICLE_RUN_MIGRATIONS` reference.
- `CLAUDE.md`, `docs/DECISIONS.md` — record the new migration workflow (ADR).

---

## Task 1: Generate the baseline migration (chain root)

**Files:**
- Modify: `packages/db/drizzle.config.ts`
- Create: `packages/db/drizzle/migrations/0000_baseline.sql`, `packages/db/drizzle/migrations/meta/_journal.json`, `packages/db/drizzle/migrations/meta/0000_snapshot.json`

- [ ] **Step 1: Point drizzle-kit `out` at the migrations dir**

`drizzle-kit export` (used by gen-schema.mjs) prints to stdout and ignores `out`; `drizzle-kit generate` writes to `out`. Change only `out`:

```ts
// packages/db/drizzle.config.ts
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle/migrations", // generate writes the chain here; export still prints schema.sql to stdout
});
```

- [ ] **Step 2: Generate the baseline from empty**

Run: `pnpm --filter @chronicle/db exec drizzle-kit generate --name baseline`
Expected: creates `drizzle/migrations/0000_baseline.sql` (full CREATE TYPE/TABLE DDL for the drizzle-modeled schema) plus `meta/_journal.json` and `meta/0000_snapshot.json`. Output ends with something like `Your SQL migration file ➜ drizzle/migrations/0000_baseline.sql`.

- [ ] **Step 3: Hand-append the invariants into the baseline**

The baseline must equal the FULL current schema, including the invariants drizzle can't model. Append the entire body of `drizzle/invariants.sql` to the end of `0000_baseline.sql`, preceded by a marker comment. Use the file contents verbatim (triggers, functions, partial unique indexes):

```sql
-- >>> invariants (hand-carried; drizzle-kit does not model triggers / partial unique indexes) <<<
-- Contents below are copied verbatim from packages/db/drizzle/invariants.sql at baseline time.
-- Future invariant CHANGES go in their own numbered migration, hand-written.
<paste the full current contents of drizzle/invariants.sql here>
```

Do NOT strip `--> statement-breakpoint` markers if drizzle inserted them — drizzle's migrator splits on them. The pasted invariants have none; leave them as plain statements (the migrator runs the file as one batch when no breakpoints are present).

- [ ] **Step 4: Sanity-check the baseline replays cleanly from empty**

Run: `pnpm --filter @chronicle/db exec vitest run -t "baseline replays"` — this test does not exist yet; instead do a throwaway manual check now via a node one-liner is overkill. Skip to Task 2, which builds the real replay test. For now just verify the file is non-empty and contains both `CREATE TABLE "persons"` and a `CREATE TRIGGER` line:

Run: `grep -c "CREATE TABLE" packages/db/drizzle/migrations/0000_baseline.sql && grep -c "CREATE TRIGGER" packages/db/drizzle/migrations/0000_baseline.sql`
Expected: both counts > 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle.config.ts packages/db/drizzle/migrations
git commit -m "feat(db): baseline migration 0000 (modeled schema + hand-carried invariants)"
```

---

## Task 2: Drift-guard test (snapshot ≡ chain)

**Files:**
- Create: `packages/db/src/migration-fingerprint.ts`
- Create: `packages/db/test/migration-drift.test.ts`

- [ ] **Step 1: Write the fingerprint + replay helpers**

```ts
// packages/db/src/migration-fingerprint.ts
/**
 * Test/guard helpers that bond the snapshot (schema.sql + invariants.sql) to the migration chain.
 * `fullSchemaFingerprint` introspects the ACTUAL database state via pg_catalog (not drizzle's
 * partial model) so the comparison covers triggers, indexes, constraints, and functions — the
 * invariants drizzle can't model. `replayMigrationsFromEmpty` applies the chain into a fresh PGlite
 * the way Neon's migrate() would, minus the tracking table (a from-empty replay needs no ledger).
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";

export type SchemaFingerprint = {
  columns: string[];   // "table.column type"
  enums: string[];     // "enum: a,b,c"
  indexes: string[];   // normalized indexdef
  constraints: string[]; // "table.constraint type def"
  triggers: string[];  // "table.trigger def"
  functions: string[]; // "name(args) -> body-hash"
};

type Runner = (sql: string) => Promise<Record<string, unknown>[]>;

async function rows(pg: PGlite, sql: string): Promise<Record<string, unknown>[]> {
  return (await pg.query(sql)).rows as Record<string, unknown>[];
}

/** Full introspection of a live public schema. Deterministic (sorted) for equality comparison. */
export async function fullSchemaFingerprint(run: Runner): Promise<SchemaFingerprint> {
  const columns = (
    await run(
      `SELECT table_name||'.'||column_name||' '||data_type AS v
         FROM information_schema.columns WHERE table_schema='public'`,
    )
  ).map((r) => String(r.v)).sort();

  const enums = (
    await run(
      `SELECT t.typname||': '||string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS v
         FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
         JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname='public' GROUP BY t.typname`,
    )
  ).map((r) => String(r.v)).sort();

  const indexes = (
    await run(
      `SELECT indexdef AS v FROM pg_indexes WHERE schemaname='public'`,
    )
  ).map((r) => String(r.v)).sort();

  const constraints = (
    await run(
      `SELECT conrelid::regclass||'.'||conname||' '||contype||' '||pg_get_constraintdef(oid) AS v
         FROM pg_constraint WHERE connamespace='public'::regnamespace`,
    )
  ).map((r) => String(r.v)).sort();

  const triggers = (
    await run(
      `SELECT tgrelid::regclass||'.'||tgname||' '||pg_get_triggerdef(oid) AS v
         FROM pg_trigger WHERE NOT tgisinternal
           AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)`,
    )
  ).map((r) => String(r.v)).sort();

  const functions = (
    await run(
      `SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||md5(p.prosrc) AS v
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'`,
    )
  ).map((r) => String(r.v)).sort();

  return { columns, enums, indexes, constraints, triggers, functions };
}

/** Apply every migration SQL file (in journal order) into a fresh PGlite. From-empty; no ledger. */
export async function replayMigrationsFromEmpty(pg: PGlite): Promise<void> {
  const dir = fileURLToPath(new URL("../drizzle/migrations/", import.meta.url));
  const journal = JSON.parse(
    readFileSync(new URL("../drizzle/migrations/meta/_journal.json", import.meta.url), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);
  for (const entry of ordered) {
    const sql = readFileSync(`${dir}${entry.tag}.sql`, "utf8").replaceAll(
      "--> statement-breakpoint",
      "",
    );
    await pg.exec(sql);
  }
}

/** Convenience: fingerprint a PGlite instance. */
export function pgliteRunner(pg: PGlite): Runner {
  return (sql) => rows(pg, sql);
}
```

- [ ] **Step 2: Write the drift-guard test**

```ts
// packages/db/test/migration-drift.test.ts
/**
 * THE bond between the two schema artifacts. Builds one DB from the snapshot (applySchema) and one
 * by replaying the migration chain, then asserts their full introspected fingerprints are equal.
 * If they diverge — e.g. an invariant added to invariants.sql but not carried into a migration —
 * this fails, before anything reaches Neon.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/migrate";
import {
  fullSchemaFingerprint,
  pgliteRunner,
  replayMigrationsFromEmpty,
} from "../src/migration-fingerprint";

describe("migration drift guard", () => {
  it("snapshot and migration chain produce identical schemas", async () => {
    const snapshotDb = new PGlite();
    await applySchema(snapshotDb);
    const snapshotFp = await fullSchemaFingerprint(pgliteRunner(snapshotDb));

    const chainDb = new PGlite();
    await replayMigrationsFromEmpty(chainDb);
    const chainFp = await fullSchemaFingerprint(pgliteRunner(chainDb));

    expect(chainFp).toEqual(snapshotFp);
  });

  it("the fingerprint comparator actually detects a difference", async () => {
    const a = new PGlite();
    await applySchema(a);
    const b = new PGlite();
    await applySchema(b);
    await b.exec(`CREATE TABLE "drift_probe" ("id" integer);`);

    const fpA = await fullSchemaFingerprint(pgliteRunner(a));
    const fpB = await fullSchemaFingerprint(pgliteRunner(b));
    expect(fpB).not.toEqual(fpA); // guards against a comparator that ignores everything
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @chronicle/db exec vitest run migration-drift`
Expected: both tests PASS. If the first fails with a fingerprint diff, the baseline (Task 1 Step 3) is missing invariants or has an extra object — reconcile `0000_baseline.sql` against `schema.sql` + `invariants.sql` until equal.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/migration-fingerprint.ts packages/db/test/migration-drift.test.ts
git commit -m "test(db): drift guard bonding snapshot to migration chain"
```

---

## Task 3: Neon migrate runner

**Files:**
- Create: `packages/db/src/run-migrations.ts`
- Create: `packages/db/scripts/migrate.ts`
- Modify: `packages/db/package.json`, `packages/db/src/index.ts`

- [ ] **Step 1: Write `runMigrations`**

```ts
// packages/db/src/run-migrations.ts
/**
 * Apply pending migrations to a real Postgres (Neon) using drizzle's official postgres-js migrator.
 * It creates/reads the `__drizzle_migrations` ledger, applies only unapplied files in journal order,
 * each in its own transaction, hashing file contents to detect tampering. NON-destructive: replaces
 * the old bootstrap-only applySchemaToPostgres. Idempotent — a no-op when the branch is already current.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import type { Database } from "./client";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle/migrations", import.meta.url));

export async function runMigrations(db: Database): Promise<void> {
  if (!db.$postgres) {
    throw new Error("runMigrations: requires a postgres-js Database (got PGlite/none)");
  }
  // drizzle's migrator wants the drizzle(postgres) instance; our Database is that instance plus $postgres.
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
}
```

- [ ] **Step 2: Write the CLI entry**

```ts
// packages/db/scripts/migrate.ts
/**
 * CLI: apply pending migrations to DATABASE_URL's Neon branch. Run in the Vercel buildCommand
 * BEFORE next build (see apps/web/vercel.json). Fails loud (non-zero exit) on a missing DATABASE_URL
 * or any migration error, so a broken migration fails the deploy instead of 500ing a live app.
 */
import { pathToFileURL } from "node:url";
import { createPostgresDatabase } from "../src/postgres-client";
import { runMigrations } from "../src/run-migrations";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL is not set — refusing to run migrations against nothing.");
    process.exit(1);
  }
  const db = createPostgresDatabase(url);
  try {
    await runMigrations(db);
    console.log("[migrate] ✓ migrations applied (or already current)");
    process.exit(0);
  } catch (err) {
    console.error("[migrate] ✗ migration failed:\n", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await db.$postgres.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
```

- [ ] **Step 3: Add the script + export**

```jsonc
// packages/db/package.json — scripts
"db:migrate": "tsx scripts/migrate.ts",
```

```ts
// packages/db/src/index.ts — replace the applySchemaToPostgres export line
export { applySchema, resetSchema } from "./migrate";
export { runMigrations } from "./run-migrations";
```

Add `tsx` to devDependencies if not already present (`db:check-parity` already uses it, so it is).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @chronicle/db typecheck`
Expected: PASS. If the `migrate(db as never, …)` cast complains, keep the `as never` — the Database type deliberately hides drizzle internals; the runtime object IS a drizzle-postgres-js instance.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/run-migrations.ts packages/db/scripts/migrate.ts packages/db/package.json packages/db/src/index.ts
git commit -m "feat(db): runMigrations — apply pending migrations to Neon via drizzle migrator"
```

---

## Task 4: Wire `db:generate` to emit both artifacts + CI drift check

**Files:**
- Modify: `packages/db/scripts/gen-schema.mjs`

- [ ] **Step 1: Make `db:generate` also generate a migration**

After writing `schema.sql`, run `drizzle-kit generate` so a `schema.ts` edit produces the snapshot AND a numbered migration in one command. Append to `gen-schema.mjs`:

```js
// After writeFileSync(OUT, HEADER + ddl); console.log(...):

// Also emit an incremental migration for the drizzle-modeled diff. drizzle-kit generate diffs
// schema.ts against meta/*_snapshot.json and writes a new NNNN_*.sql only when something changed
// (it prints "No schema changes" and writes nothing otherwise). Invariant changes are NOT captured
// here — hand-carry them into the emitted migration (see docs/DECISIONS.md § Migrations).
execSync("drizzle-kit generate", {
  cwd: PKG_DIR,
  encoding: "utf8",
  stdio: ["ignore", "inherit", "inherit"],
});
console.log("db:generate done — if a new migration was written, hand-carry any invariant changes into it.");
```

- [ ] **Step 2: Verify a no-op run writes no migration**

Run: `pnpm --filter @chronicle/db db:generate`
Expected: regenerates `schema.sql` (may be a no-op diff) and prints drizzle-kit's "No schema changes, nothing to migrate" (since schema.ts is unchanged since the baseline). No new file in `drizzle/migrations`.

Run: `git status --porcelain packages/db/drizzle/migrations`
Expected: empty (no new migration created by a no-op generate).

- [ ] **Step 3: Document the CI drift check (used in Task 7 verification, not code here)**

The CI drift check is: `pnpm --filter @chronicle/db db:generate && git diff --exit-code -- packages/db/drizzle`. A dirty tree means someone edited `schema.ts` without committing the regenerated `schema.sql`/migration. This is a CI wiring concern; no code change in this task beyond Step 1. (Covered again in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/gen-schema.mjs
git commit -m "feat(db): db:generate emits snapshot + migration in one step"
```

---

## Task 5: Remove the boot-time bootstrap; wire migrate into the Vercel build

**Files:**
- Modify: `apps/web/lib/runtime.ts`, `apps/web/vercel.json`, `apps/web/__tests__/next-config-db-sql-tracing.test.ts`, `packages/db/src/migrate.ts`, `packages/db/src/postgres-client.ts`

- [ ] **Step 1: Remove the `CHRONICLE_RUN_MIGRATIONS` bootstrap from runtime.ts**

Migrations now run at deploy (build), never on the request path. Delete the bootstrap block (apps/web/lib/runtime.ts ~lines 226–231) and its `applySchemaToPostgres` import (line 15). Replace the block with a one-line comment:

```ts
    db = createPostgresDatabase(process.env.DATABASE_URL);
    // Schema is advanced by `db:migrate` in the Vercel buildCommand (see apps/web/vercel.json),
    // never on the request path. No boot-time schema application here.
```

Keep the existing "Schema-drift detection lives at the DEPLOY GATE" comment that follows.

- [ ] **Step 2: Update the build command**

```jsonc
// apps/web/vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm --filter @chronicle/db db:migrate && pnpm --filter @chronicle/db db:check-parity && next build"
}
```

`db:migrate` advances the branch; `db:check-parity` is now a post-migrate assertion (belt-and-suspenders that the modeled schema matches after applying).

- [ ] **Step 3: Drop the `CHRONICLE_RUN_MIGRATIONS` test reference**

In `apps/web/__tests__/next-config-db-sql-tracing.test.ts`, the comment at line 12 references the removed bootstrap. Update the comment to describe the build-time `db:migrate` path instead (no assertion logic changes — it's a doc comment). Verify nothing in that test asserts on `CHRONICLE_RUN_MIGRATIONS`:

Run: `grep -n "CHRONICLE_RUN_MIGRATIONS" apps/web/__tests__/next-config-db-sql-tracing.test.ts`
If only the comment matches, edit the comment. If an assertion matches, remove that assertion.

- [ ] **Step 4: Retire `applySchemaToPostgres`**

Delete `applySchemaToPostgres` from `packages/db/src/migrate.ts` (it is no longer exported or called after Steps 1–3). Update the module doc's final paragraph to point at `run-migrations.ts` for prod evolution. Also update the stale "single-schema, no migrations" / "Bootstrap a fresh prod database with applySchemaToPostgres" paragraph in `packages/db/src/postgres-client.ts` to reference `runMigrations`.

Run: `grep -rn "applySchemaToPostgres" packages apps --include=*.ts | grep -v ".claude/worktrees"`
Expected: no matches (outside the unrelated worktree copies).

- [ ] **Step 5: Full build + test**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS. The `next-config-db-sql-tracing` test and all db tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/runtime.ts apps/web/vercel.json apps/web/__tests__/next-config-db-sql-tracing.test.ts packages/db/src/migrate.ts packages/db/src/postgres-client.ts
git commit -m "feat(db): migrate at build; remove boot-time schema bootstrap"
```

---

## Task 6: One-time Neon bootstrap (destructive — HUMAN-APPROVED)

**This task resets both Neon branches. It is the only destructive step and requires explicit human go-ahead before running.** No critical data exists (per spec), so a reset is safe now.

**Files:** none (operational; executed via the Neon MCP tools against the `familyapp` project).

- [ ] **Step 1: Confirm the branches and current data with the human**

List Neon branches (dev + production) and confirm with the user that nothing on either branch must be preserved (dev seed data is reproducible via `dev-seed.ts`). Get an explicit "yes, reset both."

- [ ] **Step 2: Reset each branch to empty and apply the baseline via the migrator**

For EACH branch (dev, then production), point `DATABASE_URL` at that branch and run:

```bash
# Destructive: drop and recreate public, then apply the chain from 0000 (records __drizzle_migrations).
# Use the Neon MCP run_sql to DROP SCHEMA public CASCADE; CREATE SCHEMA public; on the branch, then:
DATABASE_URL="<branch-url>" pnpm --filter @chronicle/db db:migrate
```

Expected: `[migrate] ✓ migrations applied (or already current)` and a `__drizzle_migrations` table now present with one row (the baseline).

- [ ] **Step 3: Verify parity on each branch**

```bash
DATABASE_URL="<branch-url>" pnpm --filter @chronicle/db db:check-parity
```

Expected: `[check-parity] ✓ live database schema matches drizzle/schema.sql` on both branches.

- [ ] **Step 4: Re-seed the dev branch (optional, non-destructive to prod)**

If dev seed data is wanted back, run the existing dev-seed path against the dev branch. This does not touch production.

---

## Task 7: CI drift check + docs + memory

**Files:**
- Modify: the repo's CI workflow (if present under `.github/workflows`), `docs/DECISIONS.md`, `CLAUDE.md`

- [ ] **Step 1: Find the CI workflow**

Run: `ls .github/workflows 2>/dev/null || echo "no github workflows"`
If a workflow runs `pnpm -r test`, add a drift-check step to the db job. If there is no CI workflow, note it in DECISIONS.md as a manual pre-push check and skip the YAML.

- [ ] **Step 2: Add the drift-check step (if a workflow exists)**

```yaml
      - name: Schema/migration drift check
        run: pnpm --filter @chronicle/db db:generate && git diff --exit-code -- packages/db/drizzle
```

A dirty tree fails CI: schema.ts changed without committing the regenerated snapshot + migration.

- [ ] **Step 3: Record the ADR**

Add a section to `docs/DECISIONS.md`: the migration model (two artifacts, drizzle-kit engine, drift guard, migrate-at-build, shared preview branch, forward-only), citing the spec. Update the migration guidance in `CLAUDE.md` (the "single schema, no migrations" mental model is now superseded for durable envs).

- [ ] **Step 4: Update auto-memory**

Update the `single-schema-no-migrations` memory (and add a `db-migrations` memory) to reflect: Neon now advanced by a drizzle-kit migration chain via `db:migrate` at build; dev/tests still use the fast snapshot; the two are bonded by `migration-drift.test.ts`. Add the MEMORY.md index line.

- [ ] **Step 5: Commit**

```bash
git add docs/DECISIONS.md CLAUDE.md .github/workflows 2>/dev/null
git commit -m "docs(db): record migration workflow (ADR) + CI drift check"
```

---

## Self-Review Notes

- **Spec coverage:** two-artifacts (Task 1,4) ✓; drift guard (Task 2) ✓; migrate runner replacing applySchemaToPostgres (Task 3,5) ✓; migrate-at-build (Task 5) ✓; one-time bootstrap (Task 6) ✓; deferred items (Atlas, per-PR branches, release-step, down-migrations) stay deferred ✓; CI drift check (Task 7) ✓.
- **Invariants:** hand-carried in Task 1 Step 3; guarded by Task 2; forward changes documented in Task 4 Step 1 comment.
- **Type consistency:** `runMigrations(db: Database)`, `fullSchemaFingerprint(run)`, `replayMigrationsFromEmpty(pg)`, `pgliteRunner(pg)` used consistently across tasks.
- **Destructive step isolated:** Task 6 only, gated on human approval.
