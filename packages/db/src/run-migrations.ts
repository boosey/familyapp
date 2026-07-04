/**
 * Apply pending migrations to a real Postgres (Neon) using drizzle's official postgres-js migrator.
 * It creates/reads the `__drizzle_migrations` ledger, applies only unapplied files in journal order,
 * each in its own transaction, hashing file contents to detect tampering. NON-destructive: replaces
 * the old bootstrap-only applySchemaToPostgres. Idempotent — a no-op when the branch is already current.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import type { Database } from "./client";

// Resolved lazily (inside runMigrations), not at module top-level: `new URL(..., import.meta.url)`
// resolves to a non-file scheme under some test runners (jsdom), so a top-level `fileURLToPath`
// would throw merely on importing @chronicle/db. runMigrations only ever runs against real Postgres.
export async function runMigrations(db: Database): Promise<void> {
  if (!db.$postgres) {
    throw new Error("runMigrations: requires a postgres-js Database (got PGlite/none)");
  }
  const migrationsFolder = fileURLToPath(new URL("../drizzle/migrations", import.meta.url));
  // drizzle's migrator wants the drizzle(postgres) instance; our Database is that instance plus $postgres.
  await migrate(db as never, { migrationsFolder });
}
