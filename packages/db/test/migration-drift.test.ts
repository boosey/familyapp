/**
 * THE bond between the two schema artifacts. Builds one DB from the snapshot (applySchema) and one
 * by replaying the migration chain, then asserts their full introspected fingerprints are equal.
 * If they diverge — e.g. an invariant added to invariants.sql but not carried into a migration —
 * this fails, before anything reaches Neon.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/migrate";
import {
  fullSchemaFingerprint,
  pgliteRunner,
  replayMigrationsFromEmpty,
} from "../src/migration-fingerprint";

describe("migration drift guard", () => {
  it("snapshot and migration chain produce identical schemas", async () => {
    const snapshotDb = new PGlite();
    await applySchema(snapshotDb);
    const snapshotFp = await fullSchemaFingerprint(pgliteRunner(snapshotDb));

    const chainDb = new PGlite();
    await replayMigrationsFromEmpty(chainDb);
    const chainFp = await fullSchemaFingerprint(pgliteRunner(chainDb));

    expect(chainFp).toEqual(snapshotFp);
  }, 30000); // heavy: 2 PGlite DBs + full migration-chain replay; 5s default flakes under parallel load

  it("the fingerprint comparator actually detects a difference", async () => {
    const a = new PGlite();
    await applySchema(a);
    const b = new PGlite();
    await applySchema(b);
    await b.exec(`CREATE TABLE "drift_probe" ("id" integer);`);

    const fpA = await fullSchemaFingerprint(pgliteRunner(a));
    const fpB = await fullSchemaFingerprint(pgliteRunner(b));
    expect(fpB).not.toEqual(fpA);
  }, 30000);

  it("the fingerprint detects a column-level change (default / nullability / enum type)", async () => {
    const a = new PGlite();
    await applySchema(a);
    const b = new PGlite();
    await applySchema(b);
    // Same tables/columns/data_type — only the DEFAULT changes. A data_type-only fingerprint
    // would miss this; the enriched fingerprint (udt_name + null + default) catches it.
    await b.exec(`ALTER TABLE "accounts" ALTER COLUMN "active" SET DEFAULT false;`);

    const fpA = await fullSchemaFingerprint(pgliteRunner(a));
    const fpB = await fullSchemaFingerprint(pgliteRunner(b));
    expect(fpB).not.toEqual(fpA);
  }, 30000);
});
