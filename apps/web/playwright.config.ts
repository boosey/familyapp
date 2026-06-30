import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config for @chronicle/web.
 *
 * HERMETIC BY DESIGN — the test server is a throwaway instance, fully isolated from your
 * everyday `next dev` (port 3000) and its `.pglite/dev` database:
 *   - Port 3100 (never 3000), so a running dev server is untouched and uncollided.
 *   - Clerk keys are blanked in `webServer.env`, which flips `isClerkConfigured()` to false →
 *     the MOCK auth provider + no-op middleware. That makes auth deterministic and lets the
 *     `/dev/sign-in` one-click "become a seeded person" path work. (Passing the keys as empty
 *     strings is load-bearing: `@next/env` will not overwrite a var that already exists in
 *     `process.env`, so `.env.local`'s real Clerk keys are suppressed for this process only.)
 *   - CHRONICLE_DB_DIR / CHRONICLE_MEDIA_DIR point at dedicated `.pglite/e2e` / `.media-e2e`
 *     dirs (both git-ignored), so seeding/TRUNCATE never disturbs your dev data.
 *
 * The single in-process PGlite DB is shared global state, so the suite runs SERIALLY
 * (workers: 1, fullyParallel: false). Parallel specs would stomp each other's seed.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Single shared DB ⇒ serialize. Revisit only if the app gains per-test DB isolation.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // First hit to a route triggers a cold Next dev compile; give actions room before failing.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    navigationTimeout: 30_000,
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // Bypass the package's `predev` port-check (it targets 3000) by invoking next directly.
    command: `pnpm exec next dev --port ${PORT}`,
    cwd: HERE,
    url: BASE_URL,
    // Reuse is OPT-IN (PW_REUSE_SERVER=1), never the default. If Playwright reused whatever happens
    // to answer on :3100, it would skip spawning and NEVER apply `env` below — a stale non-hermetic
    // server (real Clerk/Groq, real DB) would be used silently and tests would pass for the wrong
    // reason. Default = always spawn a fresh hermetic server; CI never reuses. Only set
    // PW_REUSE_SERVER=1 when you KNOW the :3100 server is this hermetic one (e.g. fast local reruns).
    reuseExistingServer: !process.env.CI && process.env.PW_REUSE_SERVER === "1",
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // Force the hermetic mock-auth path (see header note).
      CLERK_SECRET_KEY: "",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      // Force the fully-offline pipeline: with no vendor keys, lib/runtime.ts falls back to the
      // deterministic ScriptedTranscriber + ScriptedLanguageModel, so the record→render flow runs
      // end-to-end with zero paid vendor calls and identical output every run. (Empty strings are
      // load-bearing — @next/env will not overwrite a var already present in process.env, so these
      // suppress .env.local's real GROQ/XAI keys for this process only.)
      GROQ_API_KEY: "",
      XAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      // CRITICAL isolation: blank DATABASE_URL. runtime.ts uses managed Postgres whenever
      // DATABASE_URL is set and then IGNORES CHRONICLE_DB_DIR entirely — so a developer with
      // DATABASE_URL pointing at a real/staging DB would have the seed's `resetSchema` (a full
      // drop-and-recreate, run on every reseed) wipe that database. Empty string forces the
      // disposable PGlite path below. (Same @next/env precedence trick as the keys above.)
      DATABASE_URL: "",
      // Throwaway data dirs, anchored to apps/web by lib/runtime.ts (used only on the PGlite path).
      CHRONICLE_DB_DIR: ".pglite/e2e",
      CHRONICLE_MEDIA_DIR: ".media-e2e",
    },
  },
});
