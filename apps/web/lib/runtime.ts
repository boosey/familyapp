/**
 * DEV runtime wiring (local `next dev` only).
 *
 * Builds a persistent PGlite database and a filesystem media store, applying the schema once.
 * In PRODUCTION this module is the single place to swap in managed Postgres (Supabase/Neon via a
 * node-postgres Drizzle adapter) and Cloudflare R2 (R2MediaStorage) — nothing else in the app
 * changes, because everything depends on the @chronicle/* interfaces, not these concretions.
 */
import "server-only";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMigrations,
  applyMigrationsToPostgres,
  createPgliteDatabase,
  createPostgresDatabase,
  type Database,
} from "@chronicle/db";
import { FilesystemMediaStorage, type MediaStorage } from "@chronicle/storage";
import {
  createDevCookieAuthProvider,
  type AuthProvider,
} from "./auth";
import { createClerkAuthProvider } from "./auth-clerk";
import { isClerkConfigured } from "./clerk-config";

export { isClerkConfigured };

// Anchor relative paths to the apps/web package dir, not process.cwd(). On Windows Next dev's
// recursive `mkdirSync` against a relative path occasionally ENOENTs even when the directory
// already exists, depending on which cwd Next chose. Absolute paths sidestep the class of issue.
const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function anchor(p: string): string {
  return isAbsolute(p) ? p : resolve(PKG_DIR, p);
}

const DEV_DB_DIR = anchor(process.env.CHRONICLE_DB_DIR ?? "./.pglite/dev");
const DEV_MEDIA_DIR = anchor(process.env.CHRONICLE_MEDIA_DIR ?? "./.media");

type Runtime = { db: Database; storage: MediaStorage; auth: AuthProvider };

// Survive HMR in dev: cache on globalThis so we don't reopen PGlite on every reload.
const globalForRuntime = globalThis as unknown as {
  __chronicleRuntime?: Promise<Runtime>;
};

// PGlite (Node) does not create the data directory itself — pre-create it so a fresh clone
// can boot without manual `mkdir`. Same idea for the media dir.
// Node 24 on Windows can spuriously throw ENOENT from `mkdirSync(p, {recursive:true})` even
// when the directory exists — guard with existsSync and swallow non-fatal failures (we
// re-verify with statSync at the end so a truly missing dir still surfaces).
function ensureDir(p: string): void {
  try {
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true });
    }
  } catch (err) {
    const exists = existsSync(p) && statSync(p).isDirectory();
    if (!exists) throw err;
  }
}

async function build(): Promise<Runtime> {
  ensureDir(DEV_MEDIA_DIR);
  // Runtime switch: in PROD, hosts set DATABASE_URL (Supabase / Neon / any managed Postgres)
  // and we use the postgres-js Drizzle adapter. Otherwise — local dev, CI, anywhere unset —
  // stay on PGlite so `pnpm dev` keeps working with no external Postgres to provision.
  let db: Database;
  if (process.env.DATABASE_URL) {
    db = createPostgresDatabase(process.env.DATABASE_URL);
    // First-boot bootstrap only, and opt-in: every Next.js cold start AND every HMR cycle would
    // otherwise hammer `applyMigrationsToPostgres`. Ongoing schema changes go through
    // `drizzle-kit migrate` as a deploy step; this in-process path is for bootstrapping a fresh
    // Supabase/Neon project. Set `CHRONICLE_RUN_MIGRATIONS=1` on the boot that should run it.
    if (db.$postgres && process.env.CHRONICLE_RUN_MIGRATIONS === "1") {
      await applyMigrationsToPostgres(db.$postgres);
    }
  } else {
    ensureDir(DEV_DB_DIR);
    db = createPgliteDatabase(DEV_DB_DIR);
    // Apply migrations idempotently: if the schema is already there, skip.
    try {
      await db.$pglite!.query("select 1 from persons limit 1");
    } catch {
      await applyMigrations(db.$pglite!);
    }
  }
  const storage = new FilesystemMediaStorage({
    baseDir: DEV_MEDIA_DIR,
    publicBaseUrl: "/media",
  });
  // Runtime switch: production hosts set both Clerk keys with valid prefixes and get the Clerk
  // adapter; local dev and CI leave them unset (or use placeholders) and keep the cookie stub
  // (so `pnpm dev` works with no Clerk account).
  const auth: AuthProvider = isClerkConfigured()
    ? createClerkAuthProvider(db)
    : createDevCookieAuthProvider(db);
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
