/**
 * Regression guard for the "/sign-in?error=callback on every sign-in" outage (2026-07-02).
 *
 * ROOT CAUSE: @chronicle/db reads `packages/db/drizzle/{schema,invariants}.sql` at RUNTIME
 * (migrate.ts → schemaSql()). Those `.sql` files are plain assets read via
 * `readFileSync(fileURLToPath(new URL(...)))`, which Next's file tracer (@vercel/nft) does NOT
 * follow, so on Vercel they were absent from the serverless bundle. The original trigger was a
 * boot-time parity guard that ran on every cold start and threw `ENOENT ... schema.sql`, which
 * /auth/callback caught and turned into `/sign-in?error=callback` for every sign-in / create-family
 * / hub load. That guard has since moved to a Vercel-build deploy gate (scripts/check-parity.ts), so
 * the parity path no longer reads the file at runtime — but `schemaSql()` is STILL read at runtime by
 * the `CHRONICLE_RUN_MIGRATIONS=1` fresh-DB bootstrap (applySchemaToPostgres) and by dev PGlite boot
 * (applySchema). Those are latent ENOENT traps on any serverless target, so the trace include stays.
 *
 * FIX: `outputFileTracingIncludes` in next.config.mjs force-bundles the `.sql` files, with
 * `outputFileTracingRoot` set to the monorepo root so the sibling-package files are traceable.
 *
 * This is a CONFIG-LOCK test, not a reproduction: the failure only manifests inside a serverless
 * bundle (nft tracing), which a unit test cannot recreate — in the repo the source tree is always
 * present, so the runtime read "works" either way. So we assert the config keeps the fix wired AND
 * that the paths it points at actually resolve to the real DDL. The build-time proof that the files
 * land in the trace lives in the `*.nft.json` output (verified at fix time); this locks the config
 * that produces it so a future edit that drops it fails CI instead of silently re-breaking prod.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const configPath = fileURLToPath(new URL("../next.config.mjs", import.meta.url));
const configSrc = readFileSync(configPath, "utf8");

describe("next.config.mjs — @chronicle/db .sql runtime-asset tracing", () => {
  it("declares outputFileTracingRoot (so sibling-package files are traceable)", () => {
    expect(configSrc).toMatch(/outputFileTracingRoot/);
  });

  it("force-includes the drizzle .sql files in the function trace", () => {
    expect(configSrc).toMatch(/outputFileTracingIncludes/);
    // The include glob that pulls in schema.sql + invariants.sql from packages/db.
    expect(configSrc).toMatch(/packages\/db\/drizzle\/\*\.sql/);
  });

  it("the referenced .sql files actually exist and carry real DDL", () => {
    for (const name of ["schema.sql", "invariants.sql"]) {
      const p = fileURLToPath(
        new URL(`../../../packages/db/drizzle/${name}`, import.meta.url),
      );
      const sql = readFileSync(p, "utf8");
      expect(sql.length).toBeGreaterThan(0);
    }
    // schema.sql must declare the persons table the whole schema hangs off of.
    const schema = readFileSync(
      fileURLToPath(new URL("../../../packages/db/drizzle/schema.sql", import.meta.url)),
      "utf8",
    );
    expect(schema).toMatch(/CREATE TABLE "persons"/);
  });
});
