/**
 * Front-door invariant for the production Postgres client.
 *
 * The PGlite client is covered by `packages/core/test/architecture.test.ts`; this test exists
 * solely to guarantee the SAME invariant holds for `createPostgresDatabase`: no relational
 * query API on Story/Media tables (because schema is intentionally not registered). Without
 * this, a future refactor that registered `{ schema }` only on the prod client would silently
 * open a bypass path in production but not in tests.
 *
 * We do NOT need to actually connect — postgres.js builds its `Sql` lazily, so constructing a
 * client against an unreachable URL is fine: Drizzle's `db.query` shape is determined at
 * construction time, not at first query.
 */
import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../src/postgres-client";

describe("createPostgresDatabase (prod) — single front door", () => {
  it("does NOT expose Drizzle's relational API for content tables", async () => {
    const db = createPostgresDatabase("postgres://fake:fake@127.0.0.1:1/none");
    try {
      const query = (db as unknown as { query: Record<string, unknown> }).query;
      // No `{ schema }` was registered — drizzle leaves `query` as an empty object, so the
      // content-table accessors must be absent. If they ever appear, a bypass has been opened.
      expect(query.stories).toBeUndefined();
      expect(query.media).toBeUndefined();
    } finally {
      // Tear down the pool so vitest exits cleanly even without a successful connection.
      await db.$postgres.end({ timeout: 0 }).catch(() => {});
    }
  });

  it("throws if neither argument nor DATABASE_URL is provided", () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => createPostgresDatabase()).toThrow(/DATABASE_URL/);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });
});
