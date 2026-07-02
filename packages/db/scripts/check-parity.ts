/**
 * Deploy-gate schema-parity check — run in the Vercel BUILD command, before `next build`
 * (see apps/web/vercel.json). Verifies the LIVE database (the Neon branch this deploy will talk
 * to, via DATABASE_URL) declares everything `drizzle/schema.sql` does. Drift → non-zero exit →
 * the build fails → the drifted schema never reaches production.
 *
 * WHY A DEPLOY GATE, NOT A RUNTIME GUARD
 * --------------------------------------
 * This replaces the `assertPostgresSchemaParity` call that used to run on every cold start inside
 * apps/web/lib/runtime.ts. A request-path guard is the wrong venue: any failure took the WHOLE app
 * down (larger blast radius than the targeted 42703 it caught) and it read a build asset off disk on
 * every cold start. Here the check runs ONCE, before deploy, and only fails the deploy — a live app
 * is never taken down by it. The parity logic itself lives in src/schema-parity.ts (unit-tested
 * against PGlite); this file is the thin CLI + connection glue.
 *
 * FAIL LOUD on a missing DATABASE_URL: a parity gate that silently skips when it can't reach a DB is
 * worse than no gate (it reads green while verifying nothing). If this ever runs without DATABASE_URL
 * it exits non-zero so the misconfiguration is visible in the build log, not swallowed.
 */
import { pathToFileURL } from "node:url";
import { createPostgresDatabase } from "../src/postgres-client";
import { assertPostgresSchemaParity } from "../src/schema-parity";

export type ParityResult = { ok: boolean; message: string };

/**
 * Connect to `url` and assert live-schema parity. Returns a structured result rather than throwing
 * or exiting, so it is unit-testable; the CLI wrapper below maps it to a process exit code.
 */
export async function checkParity(url: string | undefined): Promise<ParityResult> {
  if (!url) {
    return {
      ok: false,
      message:
        "DATABASE_URL is not set — cannot verify schema parity against the live database. " +
        "Refusing to pass a gate that verified nothing.",
    };
  }
  const db = createPostgresDatabase(url);
  try {
    await assertPostgresSchemaParity(db.$postgres);
    return { ok: true, message: "live database schema matches drizzle/schema.sql" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    // Always release the pool so the script process can exit promptly.
    await db.$postgres.end().catch(() => {});
  }
}

/** CLI entry: run the check against DATABASE_URL and exit 0 (parity) or 1 (drift / misconfig). */
async function main(): Promise<void> {
  const result = await checkParity(process.env.DATABASE_URL);
  if (result.ok) {
    console.log(`[check-parity] ✓ ${result.message}`);
    process.exit(0);
  }
  console.error("[check-parity] ✗ schema parity check FAILED:\n");
  console.error(result.message);
  process.exit(1);
}

// Only run the CLI when invoked directly (`tsx scripts/check-parity.ts`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
