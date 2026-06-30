import { describe, it, expect } from "vitest";
import config from "../playwright.config";

/**
 * Regression guard for the e2e harness's hermetic isolation (companion to the adversarial review
 * that caught the original gap). The Playwright test server must never inherit real credentials or
 * a real database from `.env.local`:
 *
 *   - DATABASE_URL blank is the load-bearing one — if set, lib/runtime.ts routes to managed Postgres
 *     and ignores CHRONICLE_DB_DIR, so the seed's `resetSchema` (drop-and-recreate) would WIPE that
 *     real database on every reseed.
 *   - Clerk keys blank → mock auth; vendor keys blank → offline ScriptedTranscriber/LanguageModel.
 *
 * If someone deletes one of these blanks from playwright.config.ts, this test fails loudly instead of
 * the suite silently passing against real infrastructure.
 */
describe("playwright e2e config — hermetic isolation guards", () => {
  const ws = config.webServer;
  const server = Array.isArray(ws) ? ws[0] : ws;
  const env = (server?.env ?? {}) as Record<string, string>;

  it.each([
    "DATABASE_URL",
    "CLERK_SECRET_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "GROQ_API_KEY",
    "XAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ])("blanks %s so .env.local cannot leak into the test server", (key) => {
    expect(env[key]).toBe("");
  });

  it("targets the disposable PGlite/media dirs, never the real dev ones", () => {
    expect(env.CHRONICLE_DB_DIR).toBe(".pglite/e2e");
    expect(env.CHRONICLE_MEDIA_DIR).toBe(".media-e2e");
  });

  it("does not reuse an existing :3100 server unless explicitly opted in", () => {
    // Default + CI must spawn a fresh server (so `env` above is actually applied). The opt-in path
    // (PW_REUSE_SERVER=1) is the developer's deliberate choice and is excluded from this assertion.
    if (process.env.PW_REUSE_SERVER === "1") return;
    expect(server?.reuseExistingServer).toBe(false);
  });
});
