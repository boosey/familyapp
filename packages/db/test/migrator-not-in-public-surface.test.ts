/**
 * Regression guard for the Vercel build failure on 2026-07-04.
 *
 * `run-migrations.ts` resolves its migrations folder from `import.meta.url` and pulls in drizzle's
 * postgres-js migrator. It is a BUILD-TIME-ONLY utility — invoked solely by `scripts/migrate.ts`
 * (the `db:migrate` CLI) via a direct relative import. When it was ALSO re-exported from the package
 * entry (`src/index.ts`), Next.js/webpack pulled it into the APP bundle (index.ts → runtime.ts →
 * server actions) and failed the production build trying to statically resolve
 * `new URL("../drizzle/migrations", import.meta.url)` as a module.
 *
 * Keeping the migrator off the public surface keeps it out of the app bundle. This test fails if a
 * future change re-exports it from the package entry, before that change can break a deploy.
 */
import { describe, expect, it } from "vitest";
import * as publicSurface from "../src/index";

describe("migrator is not on the package public surface", () => {
  it("does not re-export runMigrations from @chronicle/db", () => {
    // The db:migrate CLI imports runMigrations from '../src/run-migrations' directly; the package
    // entry must NOT surface it, or app code importing @chronicle/db bundles the migrator.
    expect("runMigrations" in publicSurface).toBe(false);
  });
});
