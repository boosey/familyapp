/**
 * Apply the schema (generated table DDL + custom invariants) to a PGlite instance. Shared by the
 * test harness (fresh in-memory DB per test) and any dev bootstrap (persistent dataDir).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import type postgres from "postgres";

const MIGRATIONS = [
  "../drizzle/0000_init.sql",
  "../drizzle/custom/0001_invariants.sql",
];

function readMigrationSql(rel: string): string {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  return readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", "");
}

export async function applyMigrations(pg: PGlite): Promise<void> {
  for (const rel of MIGRATIONS) {
    await pg.exec(readMigrationSql(rel));
  }
}

/**
 * Apply the same migration SQL to a real Postgres server (Supabase, Neon, ...) via the
 * `postgres` (postgres.js) driver. Idempotent: a `_chronicle_meta` row records which migration
 * files have run, so a re-invocation on an already-bootstrapped database is a no-op.
 *
 * Why a meta table and not blind re-apply: `0001_invariants.sql` uses `CREATE TRIGGER` (NOT
 * `CREATE OR REPLACE`), which would error on the second run. A bootstrap guard is the simplest
 * correct shape for a fresh-database first boot. For ONGOING schema changes prefer the
 * `drizzle-kit migrate` flow against `DATABASE_URL`; this function is for the bootstrap path.
 */
export async function applyMigrationsToPostgres(
  sql: postgres.Sql,
): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _chronicle_meta (
      migration text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  for (const rel of MIGRATIONS) {
    const name = rel.replace(/^\.\.\//, "");
    const body = readMigrationSql(rel);
    // Race-safe bootstrap: the INSERT itself is the lock. Two concurrent first-boots both pass a
    // pre-check `SELECT`, then both run the non-idempotent `CREATE TRIGGER` DDL and the loser
    // errors. Instead, attempt to claim the migration row with `INSERT ... ON CONFLICT DO NOTHING
    // RETURNING`: whoever wins the PK insert owns the DDL; the other tx sees 0 rows back and
    // no-ops cleanly. The whole thing stays in one transaction so a partial DDL run cannot leave
    // the meta row claimed against a half-applied schema.
    await sql.begin(async (tx) => {
      const rows = await tx<{ migration: string }[]>`
        INSERT INTO _chronicle_meta (migration)
        VALUES (${name})
        ON CONFLICT DO NOTHING
        RETURNING migration
      `;
      if (rows.length === 0) return; // another instance owns this migration
      await tx.unsafe(body);
    });
  }
}
