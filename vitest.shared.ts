import type { ViteUserConfig } from "vitest/config";

/**
 * Shared Vitest execution defaults for every package in this monorepo.
 *
 * WHY: each test file spins up its own in-process PGlite (a full Postgres compiled to
 * WASM — see packages/db/src/testing.ts). Vitest's default `forks` pool spawns one worker
 * per CPU core (~20 here), and `pnpm -r test` runs several packages at once, so the product
 * is dozens of live WASM Postgres heaps → RAM exhaustion + swap.
 *
 * Capping maxForks bounds concurrent PGlite instances PER PACKAGE. The true global ceiling is
 * MAX_FORKS × the root `test` script's `--workspace-concurrency` (currently 6 × 2 = 12 concurrent
 * WASM Postgres heaps, worst case). Both knobs multiply — tune together. MAX_FORKS is the ONE
 * place the per-package cap lives — raise it for speed, lower it for less memory.
 */
export const MAX_FORKS = 6;

export const sharedTest: ViteUserConfig["test"] = {
  pool: "forks",
  poolOptions: {
    forks: { maxForks: MAX_FORKS, minForks: 1 },
  },
};
