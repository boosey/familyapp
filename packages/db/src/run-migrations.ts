/**
 * Apply pending migrations to a real Postgres (Neon) using drizzle's official postgres-js migrator.
 * It creates/reads the `__drizzle_migrations` ledger, applies only unapplied files in journal order,
 * each in its own transaction, hashing file contents to detect tampering. NON-destructive: replaces
 * the old bootstrap-only applySchemaToPostgres. Idempotent — a no-op when the branch is already current.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./client";

// Resolved lazily (inside runMigrations), not at module top-level, and via dirname(fileURLToPath(
// import.meta.url)) + join rather than `new URL("../drizzle/migrations", import.meta.url)`. The
// latter pattern is (a) parsed by webpack as an asset/module reference — it broke the Next build when
// this file was still on the app-bundle surface — and (b) resolves to a non-file scheme under some
// test runners. This file is build-time-only (see index.ts), but keep the resolution bundler-safe.
export async function runMigrations(db: Database): Promise<void> {
  if (!db.$postgres) {
    throw new Error("runMigrations: requires a postgres-js Database (got PGlite/none)");
  }
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../drizzle/migrations");
  // drizzle's migrator wants the drizzle(postgres) instance; our Database is that instance plus $postgres.
  await migrate(db as never, { migrationsFolder });
}
