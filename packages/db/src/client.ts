/**
 * Database client factories.
 *
 * Dev/test run against PGlite — real Postgres, in-process, no server — so the append-only
 * trigger, the media-immutability trigger, and the permission joins are exercised exactly as
 * they will be in production. Production swaps in a managed Postgres (Supabase/Neon) connection
 * without changing any query code (same Drizzle, same Postgres dialect).
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzlePglite<typeof schema>> & {
  /** The underlying PGlite instance, exposed only for migrations/teardown in tests. */
  $pglite?: PGlite;
};

/**
 * Create an in-process PGlite-backed Drizzle client. Pass a `dataDir` for a persistent dev DB,
 * or omit it for a fresh ephemeral in-memory DB (the default for tests).
 */
export function createPgliteDatabase(dataDir?: string): Database {
  const pg = new PGlite(dataDir);
  const db = drizzlePglite(pg, { schema }) as Database;
  db.$pglite = pg;
  return db;
}

export { schema };
