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
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";

export type Database = PgliteDatabase & {
  /** The underlying PGlite instance, exposed only for migrations/teardown in tests. */
  $pglite?: PGlite;
};

/**
 * Create an in-process PGlite-backed Drizzle client. Pass a `dataDir` for a persistent dev DB,
 * or omit it for a fresh ephemeral in-memory DB (the default for tests).
 */
export function createPgliteDatabase(dataDir?: string): Database {
  const pg = new PGlite(dataDir);
  const db = drizzlePglite(pg) as Database; // no { schema } — see the front-door note above
  db.$pglite = pg;
  return db;
}
