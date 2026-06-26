/**
 * DEV runtime wiring (local `next dev` only).
 *
 * Builds a persistent PGlite database and a filesystem media store, applying the schema once.
 * In PRODUCTION this module is the single place to swap in managed Postgres (Supabase/Neon via a
 * node-postgres Drizzle adapter) and Cloudflare R2 (R2MediaStorage) — nothing else in the app
 * changes, because everything depends on the @chronicle/* interfaces, not these concretions.
 */
import "server-only";
import { mkdirSync } from "node:fs";
import {
  applyMigrations,
  createPgliteDatabase,
  type Database,
} from "@chronicle/db";
import { FilesystemMediaStorage, type MediaStorage } from "@chronicle/storage";
import {
  createDevCookieAuthProvider,
  type AuthProvider,
} from "./auth";

const DEV_DB_DIR = process.env.CHRONICLE_DB_DIR ?? "./.pglite/dev";
const DEV_MEDIA_DIR = process.env.CHRONICLE_MEDIA_DIR ?? "./.media";

type Runtime = { db: Database; storage: MediaStorage; auth: AuthProvider };

// Survive HMR in dev: cache on globalThis so we don't reopen PGlite on every reload.
const globalForRuntime = globalThis as unknown as {
  __chronicleRuntime?: Promise<Runtime>;
};

async function build(): Promise<Runtime> {
  // PGlite (Node) does not create the data directory itself — pre-create it so a fresh clone
  // can boot without manual `mkdir`. Same idea for the media dir.
  mkdirSync(DEV_DB_DIR, { recursive: true });
  mkdirSync(DEV_MEDIA_DIR, { recursive: true });
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
  const auth = createDevCookieAuthProvider(db);
  return { db, storage, auth };
}

export function getRuntime(): Promise<Runtime> {
  // If a previous build() rejected (e.g. transient mkdir failure during dev), don't cache the
  // poison — clear the slot on failure so the next request retries from scratch. There is a
  // benign TOCTOU here: two simultaneous callers seeing `undefined` will both call build() and
  // the second assignment wins; under PGlite's per-dir file lock the loser would fail at init.
  // Acceptable under `next dev` (single Node worker) — fix is `globalThis.__chronicleRuntime ??=`
  // semantics if we ever serve from a multi-worker dev runtime.
  if (!globalForRuntime.__chronicleRuntime) {
    const p = build();
    globalForRuntime.__chronicleRuntime = p;
    p.catch(() => {
      if (globalForRuntime.__chronicleRuntime === p) {
        globalForRuntime.__chronicleRuntime = undefined;
      }
    });
  }
  return globalForRuntime.__chronicleRuntime;
}
