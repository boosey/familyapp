/**
 * Apply pending migrations to a real Postgres (Neon) using drizzle's official postgres-js migrator.
 * It creates/reads the `__drizzle_migrations` ledger, applies only unapplied files in journal order,
 * each in its own transaction, hashing file contents to detect tampering. NON-destructive: replaces
 * the old bootstrap-only applySchemaToPostgres. Idempotent — a no-op when the branch is already current.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import type { Database } from "./client";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle/migrations", import.meta.url));

export async function runMigrations(db: Database): Promise<void> {
  if (!db.$postgres) {
    throw new Error("runMigrations: requires a postgres-js Database (got PGlite/none)");
  }
  // drizzle's migrator wants the drizzle(postgres) instance; our Database is that instance plus $postgres.
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
}
