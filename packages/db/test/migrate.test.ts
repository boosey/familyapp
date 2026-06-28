/**
 * Regression: dev DB migrations must be incremental, not all-or-nothing.
 *
 * The bug: `applyMigrations` was gated (in runtime.ts) by "does `persons` exist?" — i.e. "did the
 * FIRST migration ever run?". Once a dev PGlite DB existed, every migration added afterwards was
 * skipped wholesale, so `invitations` (added in 0002) never landed and the dev seed's TRUNCATE
 * blew up with `relation "invitations" does not exist`.
 *
 * The fix moves tracking into `applyMigrations` itself via a `_chronicle_meta` claim table, so it
 * applies only the migrations whose meta row is absent. These tests pin that behavior:
 *   - a fresh DB ends up with the later-migration tables (invitations);
 *   - re-running is a no-op (idempotent) despite non-idempotent DDL like CREATE TYPE/TRIGGER;
 *   - a DB stuck at an OLDER schema version gets the newer migration applied on the next run.
 */
import { describe, expect, it } from "vitest";
import { createPgliteDatabase } from "../src/client";
import { applyMigrations } from "../src/migrate";

const LATER_MIGRATION = "drizzle/0002_huge_pixie.sql";

describe("applyMigrations — incremental dev migrations", () => {
  it("creates later-migration tables (invitations) on a fresh DB", async () => {
    const db = createPgliteDatabase();
    await applyMigrations(db.$pglite!);
    // Throws if the relation does not exist — the original symptom.
    const res = await db.$pglite!.query("select count(*)::int as n from invitations");
    expect((res.rows[0] as { n: number }).n).toBe(0);
  });

  it("is idempotent: a second run does not re-run non-idempotent DDL", async () => {
    const db = createPgliteDatabase();
    await applyMigrations(db.$pglite!);
    // Re-running 0000/0001 (CREATE TYPE, CREATE TRIGGER) without tracking would throw here.
    await expect(applyMigrations(db.$pglite!)).resolves.toBeUndefined();
    await db.$pglite!.query("select 1 from invitations limit 1");
  });

  it("applies a newer migration to a DB stuck at an older schema version", async () => {
    const db = createPgliteDatabase();
    await applyMigrations(db.$pglite!);

    // Simulate a dev DB last booted BEFORE 0002 existed: fully revert everything 0002 (and the
    // 0003 custom index that depends on it) created — tables, enum types, and the columns it
    // added — and forget their meta claims, leaving only the earlier schema. This mirrors the
    // real bug, where the old DB had never run any of 0002.
    await db.$pglite!.exec(`
      DROP TABLE IF EXISTS join_requests CASCADE;
      DROP TABLE IF EXISTS invitations CASCADE;
      DROP TABLE IF EXISTS mock_auth_users CASCADE;
      DROP TYPE IF EXISTS invitation_status;
      DROP TYPE IF EXISTS join_request_status;
      ALTER TABLE families DROP COLUMN IF EXISTS description;
      ALTER TABLE families DROP COLUMN IF EXISTS discoverable;
      ALTER TABLE persons DROP COLUMN IF EXISTS birth_date;
      ALTER TABLE persons DROP COLUMN IF EXISTS onboarded_at;
      DELETE FROM _chronicle_meta WHERE migration LIKE '%0002_huge_pixie.sql'
        OR migration LIKE '%0003_join_request_pending_uq.sql';
    `);
    await expect(
      db.$pglite!.query("select 1 from invitations limit 1"),
    ).rejects.toThrow();

    // Booting again must bring the older DB forward — the heart of the fix.
    await applyMigrations(db.$pglite!);
    const res = await db.$pglite!.query("select count(*)::int as n from invitations");
    expect((res.rows[0] as { n: number }).n).toBe(0);

    // And only the absent migration re-ran: its meta row is back, exactly once.
    const meta = await db.$pglite!.query<{ n: number }>(
      "select count(*)::int as n from _chronicle_meta where migration = $1",
      [LATER_MIGRATION],
    );
    expect(meta.rows[0]!.n).toBe(1);
  });
});
