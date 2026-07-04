/**
 * Test/guard helpers that bond the snapshot (schema.sql + invariants.sql) to the migration chain.
 * `fullSchemaFingerprint` introspects the ACTUAL database state via pg_catalog (not drizzle's
 * partial model) so the comparison covers triggers, indexes, constraints, and functions — the
 * invariants drizzle can't model. `replayMigrationsFromEmpty` applies the chain into a fresh PGlite
 * the way Neon's migrate() would, minus the tracking table (a from-empty replay needs no ledger).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";

export type SchemaFingerprint = {
  columns: string[];
  enums: string[];
  indexes: string[];
  constraints: string[];
  triggers: string[];
  functions: string[];
};

type Runner = (sql: string) => Promise<Record<string, unknown>[]>;

async function rows(pg: PGlite, sql: string): Promise<Record<string, unknown>[]> {
  return (await pg.query(sql)).rows as Record<string, unknown>[];
}

/** Full introspection of a live public schema. Deterministic (sorted) for equality comparison. */
export async function fullSchemaFingerprint(run: Runner): Promise<SchemaFingerprint> {
  const columns = (
    await run(
      `SELECT table_name||'.'||column_name||' '||udt_name||' null='||is_nullable||' default='||coalesce(column_default,'') AS v
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
    await run(`SELECT indexdef AS v FROM pg_indexes WHERE schemaname='public'`)
  ).map((r) => String(r.v)).sort();

  const constraints = (
    await run(
      `SELECT conrelid::regclass||'.'||conname||' '||contype::text||' '||pg_get_constraintdef(oid) AS v
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
  // Mirror drizzle-orm's real migrator (`readMigrationFiles`): iterate `journal.entries` in ARRAY
  // ORDER with no re-sort, so we validate exactly the order Neon's migrate() would apply. Guard
  // against a desync (e.g. a hand-resolved journal merge conflict) rather than silently reordering:
  // if array position and idx disagree, the journal is malformed — fail loudly.
  journal.entries.forEach((entry, i) => {
    if (entry.idx !== i) {
      throw new Error(
        `Migration journal is out of order: entry "${entry.tag}" has idx=${entry.idx} at array position ${i}. ` +
          `drizzle's migrator applies entries in array order — fix _journal.json so array order matches idx.`,
      );
    }
  });
  for (const entry of journal.entries) {
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
