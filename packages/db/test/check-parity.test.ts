/**
 * Regression guard for the deploy-gate parity check (scripts/check-parity.ts).
 *
 * The check moved OUT of the request path (apps/web/lib/runtime.ts) and INTO the Vercel build
 * command. The one behavior a unit test can lock without a live Postgres is the load-bearing
 * fail-loud contract: a parity gate that silently passes when it cannot reach a database is worse
 * than no gate (it reads green while verifying nothing). If someone "helpfully" makes a missing
 * DATABASE_URL a no-op, this fails.
 *
 * The parity DIFF logic (drift → failure, parity → pass) is covered against a real in-process
 * Postgres in schema-parity.test.ts; here we only assert the CLI glue's env handling.
 */
import { describe, expect, it } from "vitest";
import { checkParity } from "../scripts/check-parity";

describe("checkParity — deploy-gate env handling", () => {
  it("fails (does NOT silently pass) when DATABASE_URL is unset", async () => {
    const result = await checkParity(undefined);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/DATABASE_URL is not set/);
  });

  it("fails when DATABASE_URL is an empty string", async () => {
    const result = await checkParity("");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/DATABASE_URL is not set/);
  });
});
