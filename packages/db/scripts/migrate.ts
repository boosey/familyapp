/**
 * CLI: apply pending migrations to DATABASE_URL's Neon branch. Run in the Vercel buildCommand
 * BEFORE next build (see apps/web/vercel.json). Fails loud (non-zero exit) on a missing DATABASE_URL
 * or any migration error, so a broken migration fails the deploy instead of 500ing a live app.
 */
import { pathToFileURL } from "node:url";
import { createPostgresDatabase } from "../src/postgres-client";
import { runMigrations } from "../src/run-migrations";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL is not set — refusing to run migrations against nothing.");
    process.exit(1);
  }
  const db = createPostgresDatabase(url);
  try {
    await runMigrations(db);
    console.log("[migrate] ✓ migrations applied (or already current)");
    process.exit(0);
  } catch (err) {
    console.error("[migrate] ✗ migration failed:\n", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await db.$postgres.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
