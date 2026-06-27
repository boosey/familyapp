/**
 * Production Postgres client factory.
 *
 * PROD WIRING
 * -----------
 * Reads the connection string from `DATABASE_URL` (override via the explicit `connectionString`
 * argument). Works against any managed Postgres — Supabase, Neon, RDS, plain self-hosted —
 * because we only use SQL the standard server understands.
 *
 * Uses `postgres` (postgres.js) as the driver, paired with `drizzle-orm/postgres-js`. Smaller
 * dependency surface than `pg`, first-class TLS, and Drizzle ships an adapter against it.
 *
 * SINGLE-FRONT-DOOR NOTE (mirrors client.ts)
 * ------------------------------------------
 * `drizzle(client)` is called WITHOUT `{ schema }` ON PURPOSE. Registering the schema would
 * enable Drizzle's relational query API (`db.query.stories.findMany()`), which is a read path
 * for Story/Media content that needs no table import and would therefore silently bypass the
 * authorization function. With no schema registered, `db.query` is an empty object: the only
 * way to query content is the query builder with an explicit table object — and those objects
 * are reachable solely via the guarded `@chronicle/db/content` subpath (enforced by
 * `packages/core/test/architecture.test.ts`).
 *
 * MIGRATIONS
 * ----------
 * Migration SQL lives in `packages/db/drizzle/` and is the same source of truth for PGlite (dev/
 * test) and prod. Apply it to a fresh prod database with `applyMigrationsToPostgres(sql)` (see
 * migrate.ts). The bootstrap is guarded by a `_chronicle_meta` table so re-running is a no-op —
 * required because the `CREATE TRIGGER` statements in `0001_invariants.sql` are not idempotent.
 * For ongoing schema changes prefer `drizzle-kit migrate` against `DATABASE_URL`; this bootstrap
 * is for the first-boot case (fresh Supabase/Neon project).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Database } from "./client";

export type PostgresClientOptions = {
  /** Override the `DATABASE_URL` env var. */
  connectionString?: string;
  /** postgres.js pool size. Default 10. */
  max?: number;
  /**
   * Extra options forwarded to `postgres()`. Use sparingly; the defaults are sized for a typical
   * serverless or single-instance Node deployment.
   *
   * NOTE on TLS: we default `ssl: 'require'` because managed Postgres providers (Supabase, Neon,
   * RDS) all require TLS and the postgres.js default of `'prefer'` would silently fall back to
   * plaintext on misconfiguration. Callers running a local Postgres without TLS can opt out via
   * `postgresOptions: { ssl: false }`.
   */
  postgresOptions?: Parameters<typeof postgres>[1];
};

/**
 * Production-grade Drizzle client backed by a real Postgres server (Supabase, Neon, ...).
 *
 * Returns a value that satisfies the same `Database` type the PGlite factory returns, so
 * application code that holds a `Database` continues to work unchanged. The optional `$pglite`
 * field is simply absent on the prod client (it is for test/dev teardown only); `$postgres` is
 * present on this factory's output for migrations/teardown.
 *
 * TLS: defaults to `ssl: 'require'`. Override with `postgresOptions: { ssl: false }` for local
 * dev against a plaintext Postgres.
 */
export function createPostgresDatabase(
  connectionStringOrOptions?: string | PostgresClientOptions,
  maybeOptions?: PostgresClientOptions,
): Database & { $postgres: ReturnType<typeof postgres> } {
  const options: PostgresClientOptions =
    typeof connectionStringOrOptions === "string"
      ? { connectionString: connectionStringOrOptions, ...maybeOptions }
      : (connectionStringOrOptions ?? {});

  const url = options.connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "createPostgresDatabase: no connection string (pass one explicitly or set DATABASE_URL)",
    );
  }

  const client = postgres(url, {
    // Default to strict TLS for managed Postgres. postgres.js's default of `'prefer'` allows
    // plaintext fallback, which is unacceptable for production. Callers explicitly opt out for
    // local plaintext dev via `postgresOptions: { ssl: false }`.
    ssl: "require",
    max: options.max ?? 10,
    ...options.postgresOptions,
  });
  // No { schema } — see the front-door note above. Single explicit `as Database` cast at the
  // factory site keeps the type-level front-door guard intact (see client.ts for the rationale).
  const db = drizzle(client) as unknown as Database & {
    $postgres: ReturnType<typeof postgres>;
  };
  db.$postgres = client;
  return db;
}
