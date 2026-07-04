/**
 * Schema application — single-schema, no incremental migrations.
 *
 * While the schema is still molten (heavy development) we do NOT keep a chain of incremental
 * migration files. `src/schema.ts` is the single source of truth; `drizzle/schema.sql` is its
 * generated full DDL (regenerate with `pnpm --filter @chronicle/db db:generate`), and
 * `drizzle/invariants.sql` holds the structural guarantees drizzle can't model (the append-only /
 * media-immutability triggers and the partial unique indexes).
 *
 * Two primitives:
 *   - `applySchema(pg)`  — apply schema + invariants if the DB is empty (idempotent create). Used
 *     by the test harness and dev boot; never destroys data.
 *   - `resetSchema(db)`  — BLOW AWAY everything and re-apply (drop schema → recreate). This is how
 *     the dev seed picks up schema changes: edit schema.ts → regenerate → reseed. DESTRUCTIVE and
 *     dev-only.
 *
 * Prod schema evolution does NOT use these primitives: managed Postgres (Neon) is advanced by the
 * drizzle-kit migration chain via `runMigrations` (see run-migrations.ts), run in the Vercel build
 * (`db:migrate`). These primitives serve PGlite dev/test and the dev reseed only.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import type { Database } from "./client";

const SCHEMA_FILES = ["../drizzle/schema.sql", "../drizzle/invariants.sql"];

function readSql(rel: string): string {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  // `--> statement-breakpoint` is a drizzle-kit marker some tools emit; harmless to strip.
  return readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", "");
}

/**
 * The full schema SQL (table DDL then invariants), concatenated. Exported so the schema-parity
 * guard can derive the EXPECTED schema from the same source of truth these apply primitives use
 * (see schema-parity.ts) — never re-read or duplicate the file path logic elsewhere.
 */
export function schemaSql(): string {
  return SCHEMA_FILES.map(readSql).join("\n");
}

/**
 * Apply the schema to a PGlite instance if it isn't already there. Idempotent via a cheap
 * existence probe (the generated DDL itself is not idempotent — CREATE TYPE / CREATE TRIGGER —
 * so we guard rather than blindly re-run). A fresh in-memory test DB gets the full schema; an
 * already-populated dev DB is left untouched (use `resetSchema` to rebuild it).
 */
export async function applySchema(pg: PGlite): Promise<void> {
  const probe = await pg.query<{ reg: string | null }>(
    "SELECT to_regclass('public.persons') AS reg",
  );
  if (probe.rows[0]?.reg) return; // schema already present
  await pg.exec(schemaSql());
}

/**
 * BLOW AWAY the entire schema and re-apply it from scratch. This is the dev seed's reset: it drops
 * `public` (every table, type, trigger, index) and rebuilds from the current schema, so a schema
 * change shows up on the next reseed with no stale-state archaeology. DESTRUCTIVE — dev only.
 *
 * Works against both the PGlite dev/test DB and a (disposable, dev) Postgres pointed at by
 * DATABASE_URL. It will refuse nothing — never wire this to a production database.
 */
export async function resetSchema(db: Database): Promise<void> {
  const drop = "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;";
  if (db.$pglite) {
    await db.$pglite.exec(drop);
    await db.$pglite.exec(schemaSql());
    return;
  }
  if (db.$postgres) {
    await db.$postgres.unsafe(drop);
    await db.$postgres.unsafe(schemaSql());
    return;
  }
  throw new Error("resetSchema: database has neither a PGlite nor a Postgres handle");
}
