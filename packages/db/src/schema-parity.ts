/**
 * Schema-parity guard — fail loud when a live Postgres DB is behind `drizzle/schema.sql`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `applySchemaToPostgres` (migrate.ts) is a BOOTSTRAP-ONLY primitive: it probes for `persons` and
 * returns early once the DB is bootstrapped, so any table/column/enum-value ADDED after first boot
 * is never applied to an already-live database. Prod Neon drifted exactly this way — it was missing
 * `stories.originating_family_id`, the `story_families` / `intake_answers` tables, the
 * `intake_origin` enum, and the `intake_audio` value on `media_kind`. Deploys succeeded; the app
 * then 500'd at query time with Postgres 42703 ("column ... does not exist"), invisible until a
 * user hit the page.
 *
 * This module turns that silent runtime failure into an explicit, descriptive boot/CI error naming
 * exactly what the live DB lacks. It mirrors the fail-loud philosophy of `selectMediaStorage` in
 * apps/web/lib/runtime.ts (throw on a half-configured deploy rather than degrade silently).
 *
 * The check is a SUBSET check (expected ⊆ actual): the DB having EXTRA objects is fine — only a DB
 * MISSING something the code declares is a fault. Every piece here is pure and testable; the only
 * I/O is `introspectSchema`, which takes a generic row executor so the same code serves both the
 * postgres-js prod client and PGlite in tests.
 */
import type postgres from "postgres";
import { schemaSql } from "./migrate";

/** The declared/observed shape: table→column names and enum type→ordered values. */
export type SchemaShape = {
  tables: Record<string, string[]>;
  enums: Record<string, string[]>;
};

/** A generic row-returning SQL executor. postgres-js: `(q) => sql.unsafe(q)`; PGlite: `(q) => pg.query(q).then(r => r.rows)`. */
export type SqlRunner = (sql: string) => Promise<Record<string, unknown>[]>;

/**
 * Parse the generated schema SQL (schema.sql + invariants.sql, concatenated) into the objects it
 * DECLARES. The file is machine-generated with stable formatting (tabs, quoted identifiers), so a
 * line parser is robust here:
 *   - `CREATE TABLE "name" ( ... )` → each column line starts with a quoted identifier; constraint
 *     lines (CONSTRAINT/PRIMARY KEY/…) do not, so they are naturally skipped.
 *   - `CREATE TYPE "public"."name" AS ENUM('a', 'b', …)` → enum name + ordered values.
 * invariants.sql has no CREATE TABLE/TYPE, so it contributes nothing.
 */
export function parseExpectedSchema(schemaSqlText: string): SchemaShape {
  const tables: Record<string, string[]> = {};
  const enums: Record<string, string[]> = {};

  let currentTable: string | null = null;
  for (const rawLine of schemaSqlText.split("\n")) {
    const line = rawLine.trimEnd();

    // Enum type declaration (single line).
    const enumMatch = /^CREATE TYPE "public"\."([^"]+)" AS ENUM\((.*)\);?/.exec(line);
    if (enumMatch) {
      const values = [...enumMatch[2]!.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
      enums[enumMatch[1]!] = values;
      continue;
    }

    // Table block start.
    const tableMatch = /^CREATE TABLE "([^"]+)" \(/.exec(line);
    if (tableMatch) {
      currentTable = tableMatch[1]!;
      tables[currentTable] = [];
      continue;
    }

    if (currentTable) {
      // Block end: a line that closes the CREATE TABLE ( ... ).
      if (line.startsWith(')')) {  // drizzle-kit always closes CREATE TABLE at col 0
        currentTable = null;
        continue;
      }
      // Column line: starts (after indentation) with a quoted identifier. Constraint lines don't.
      const colMatch = /^\s*"([^"]+)"/.exec(line);
      if (colMatch) {
        tables[currentTable]!.push(colMatch[1]!);
      }
    }
  }

  return { tables, enums };
}

/**
 * Introspect the ACTUAL live schema via `information_schema` / `pg_catalog`. `run` is a generic
 * row executor so this works unchanged against postgres-js and PGlite.
 */
export async function introspectSchema(run: SqlRunner): Promise<SchemaShape> {
  const columnRows = await run(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );
  const tables: Record<string, string[]> = {};
  for (const row of columnRows) {
    const table = String(row.table_name);
    const column = String(row.column_name);
    (tables[table] ??= []).push(column);
  }

  const enumRows = await run(
    `SELECT t.typname AS enum_name, e.enumlabel AS enum_value
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder`,
  );
  const enums: Record<string, string[]> = {};
  for (const row of enumRows) {
    const name = String(row.enum_name);
    const value = String(row.enum_value);
    (enums[name] ??= []).push(value);
  }

  return { tables, enums };
}

/**
 * Diff expected against actual, returning a list of human-readable problems (empty = parity). This
 * is a SUBSET check: every EXPECTED object must exist in actual; extra actual objects are fine.
 */
export function diffSchema(expected: SchemaShape, actual: SchemaShape): string[] {
  const problems: string[] = [];

  for (const [table, columns] of Object.entries(expected.tables)) {
    const actualColumns = actual.tables[table];
    if (!actualColumns) {
      problems.push(`missing table "${table}"`);
      continue;
    }
    const have = new Set(actualColumns);
    for (const column of columns) {
      if (!have.has(column)) {
        problems.push(`missing column "${table}"."${column}"`);
      }
    }
  }

  for (const [enumName, values] of Object.entries(expected.enums)) {
    const actualValues = actual.enums[enumName];
    if (!actualValues) {
      problems.push(`missing enum type "${enumName}"`);
      continue;
    }
    const have = new Set(actualValues);
    for (const value of values) {
      if (!have.has(value)) {
        problems.push(`missing enum value '${value}' on type "${enumName}"`);
      }
    }
  }

  return problems;
}

/** Options for {@link assertSchemaParity}. */
export type AssertSchemaParityOptions = {
  /** Inject the expected shape (tests). Defaults to `parseExpectedSchema(schemaSql())`. */
  expected?: SchemaShape;
};

/**
 * Assert the live DB (via `run`) declares everything `drizzle/schema.sql` does. Throws a
 * descriptive, multi-line error listing exactly what is missing when it drifts behind the code
 * schema — the boot/CI signal that replaces a silent runtime 42703.
 */
export async function assertSchemaParity(
  run: SqlRunner,
  opts: AssertSchemaParityOptions = {},
): Promise<void> {
  const expected = opts.expected ?? parseExpectedSchema(schemaSql());
  const actual = await introspectSchema(run);
  const problems = diffSchema(expected, actual);
  if (problems.length === 0) return;

  throw new Error(
    [
      `Database schema is behind drizzle/schema.sql — ${problems.length} missing object(s):`,
      ...problems.map((p) => `  - ${p}`),
      "",
      "The live Postgres/Neon DB does not declare everything the code schema does — leaving queries to",
      "500 with Postgres 42703 at runtime. Migrations are applied by `db:migrate` (runMigrations, the",
      "drizzle postgres-js migrator), which runs BEFORE this check in the Vercel buildCommand",
      "(db:migrate && db:check-parity && next build). Parity failing AFTER migrate means a migration is",
      "missing/incomplete for the object(s) listed above: regenerate with",
      "`pnpm --filter @chronicle/db db:generate` (emits both the snapshot and a new migration) and",
      "hand-carry any invariant changes into the emitted migration. In dev, reset instead: resetSchema.",
    ].join("\n"),
  );
}

/**
 * Convenience wrapper for a postgres-js client. `sql.unsafe(q)` returns the rows directly, which is
 * exactly the {@link SqlRunner} contract.
 */
export async function assertPostgresSchemaParity(
  sql: postgres.Sql,
  opts: AssertSchemaParityOptions = {},
): Promise<void> {
  await assertSchemaParity((q) => sql.unsafe(q) as Promise<Record<string, unknown>[]>, opts);
}
