/**
 * DEV runtime wiring (local `next dev` only).
 *
 * Builds a persistent PGlite database and a filesystem media store, applying the schema once.
 * In PRODUCTION this module is the single place to swap in managed Postgres (Supabase/Neon via a
 * node-postgres Drizzle adapter) and Cloudflare R2 (R2MediaStorage) — nothing else in the app
 * changes, because everything depends on the @chronicle/* interfaces, not these concretions.
 */
import "server-only";
import {
  applyMigrations,
  createPgliteDatabase,
  type Database,
} from "@chronicle/db";
import { FilesystemMediaStorage, type MediaStorage } from "@chronicle/storage";

const DEV_DB_DIR = process.env.CHRONICLE_DB_DIR ?? "./.pglite/dev";
const DEV_MEDIA_DIR = process.env.CHRONICLE_MEDIA_DIR ?? "./.media";

type Runtime = { db: Database; storage: MediaStorage };

// Survive HMR in dev: cache on globalThis so we don't reopen PGlite on every reload.
const globalForRuntime = globalThis as unknown as {
  __chronicleRuntime?: Promise<Runtime>;
};

async function build(): Promise<Runtime> {
  const db = createPgliteDatabase(DEV_DB_DIR);
  // Apply migrations idempotently: if the schema is already there, skip.
  try {
    await db.$pglite!.query("select 1 from persons limit 1");
  } catch {
    await applyMigrations(db.$pglite!);
  }
  const storage = new FilesystemMediaStorage({
    baseDir: DEV_MEDIA_DIR,
    publicBaseUrl: "/media",
  });
  return { db, storage };
}

export function getRuntime(): Promise<Runtime> {
  globalForRuntime.__chronicleRuntime ??= build();
  return globalForRuntime.__chronicleRuntime;
}
