/**
 * Database client factories.
 *
 * Dev/test run against PGlite — real Postgres, in-process, no server — so the append-only
 * trigger, the media-immutability trigger, and the permission joins are exercised exactly as
 * they will be in production. Production swaps in a managed Postgres (Supabase/Neon) connection
 * without changing any query code (same Drizzle, same Postgres dialect).
 *
 * SINGLE-FRONT-DOOR NOTE: the schema is intentionally NOT registered on the runtime client.
 * Registering it would enable Drizzle's relational query API (`db.query.stories.findMany()`),
 * which is a read path for Story/Media content that needs no table import and would therefore
 * silently bypass the authorization function. Without it, the only way to query content is the
 * query builder with an explicit table object — and those objects are reachable solely via the
 * guarded `@chronicle/db/schema` subpath (enforced by packages/core/test/architecture.test.ts).
 *
 * The `Database` type below pins the schema generic to `Record<string, never>` so the front
 * door is enforced at the TYPE LEVEL as well: Drizzle's `PgDatabase` declares
 * `query: TFullSchema extends Record<string, never> ? DrizzleTypeError<...> : {...}`, so any
 * caller that writes `db.query.stories` gets a compile-time error, not just a runtime undefined.
 * Using `any` for the schema generic would silently re-open this bypass at compile time.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * Application-facing database handle. The schema generic is deliberately `Record<string, never>`
 * — this makes `db.query.stories` / `db.query.media` resolve to Drizzle's `DrizzleTypeError`
 * (a compile-time error), structurally enforcing the front door at the type level. The driver-
 * specific escape hatches (`$pglite`, `$postgres`) are optional and only used by migrations
 * and teardown.
 */
export type Database = PgDatabase<PgQueryResultHKT, Record<string, never>> & {
  /** The underlying PGlite instance, exposed only for migrations/teardown in tests. */
  $pglite?: PGlite;
  /** The underlying postgres.js client, exposed only for migrations/teardown in prod. */
  $postgres?: import("postgres").Sql;
};

/**
 * Create an in-process PGlite-backed Drizzle client. Pass a `dataDir` for a persistent dev DB,
 * or omit it for a fresh ephemeral in-memory DB (the default for tests).
 */
export function createPgliteDatabase(dataDir?: string): Database {
  const pg = new PGlite(dataDir);
  // No { schema } — see the front-door note above. The single `as Database` cast is the explicit
  // narrowing site: drizzle()'s return widens TFullSchema to `Record<string, unknown>`, we pin
  // it back to `Record<string, never>` so the type-level front-door guard holds.
  const db = drizzlePglite(pg) as unknown as Database;
  db.$pglite = pg;
  return db;
}
