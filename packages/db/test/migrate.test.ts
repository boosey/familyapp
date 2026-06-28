/**
 * Single-schema application (no incremental migrations).
 *
 * While the schema is molten we do not keep a migration chain: `schema.ts` → `drizzle/schema.sql`
 * is the whole schema, applied wholesale. These tests pin the two primitives:
 *   - `applySchema` builds the full schema on a fresh DB (including `link_sessions` — the table the
 *     old `elder_sessions`→`link_sessions` rename used to produce) and is idempotent;
 *   - `resetSchema` blows the DB away and rebuilds it, which is how a reseed picks up schema edits.
 */
import { describe, expect, it } from "vitest";
import { createPgliteDatabase } from "../src/client";
import { applySchema, resetSchema } from "../src/migrate";

describe("applySchema — single full-schema apply", () => {
  it("builds the full schema on a fresh DB (link_sessions, invitations, asks all present)", async () => {
    const db = createPgliteDatabase();
    await applySchema(db.$pglite!);
    // Each throws if its relation is missing.
    for (const table of ["link_sessions", "invitations", "join_requests", "asks", "mock_auth_users"]) {
      const res = await db.$pglite!.query(`select count(*)::int as n from ${table}`);
      expect((res.rows[0] as { n: number }).n).toBe(0);
    }
  });

  it("applies the structural invariants (append-only trigger on consent_records)", async () => {
    const db = createPgliteDatabase();
    await applySchema(db.$pglite!);
    const res = await db.$pglite!.query<{ n: number }>(
      "select count(*)::int as n from pg_trigger where tgname = 'consent_records_append_only'",
    );
    expect(res.rows[0]!.n).toBe(1);
  });

  it("is idempotent: a second apply is a no-op despite non-idempotent DDL (CREATE TYPE/TRIGGER)", async () => {
    const db = createPgliteDatabase();
    await applySchema(db.$pglite!);
    // A blind re-run of CREATE TYPE/TRIGGER would throw; the existence guard makes it a no-op.
    await expect(applySchema(db.$pglite!)).resolves.toBeUndefined();
  });
});

describe("resetSchema — blow away and rebuild", () => {
  it("drops existing data and re-applies the schema", async () => {
    const db = createPgliteDatabase();
    await applySchema(db.$pglite!);
    await db.$pglite!.query(
      "insert into accounts (auth_provider_user_id, email) values ('dev:x', 'x@example.test')",
    );
    const before = await db.$pglite!.query<{ n: number }>(
      "select count(*)::int as n from accounts",
    );
    expect(before.rows[0]!.n).toBe(1);

    await resetSchema(db);

    // Schema is back (query succeeds) and the row is gone.
    const after = await db.$pglite!.query<{ n: number }>(
      "select count(*)::int as n from accounts",
    );
    expect(after.rows[0]!.n).toBe(0);
  });
});
