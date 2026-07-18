/**
 * Unit tests for the deploy-gate critical-env check (scripts/check-env.mjs).
 *
 * The check is a pure `env -> result` function (same testable shape as check-parity.ts): the CLI
 * wrapper only maps its result to a process exit code. These tests pin the contract so the required
 * set can't silently shrink — the whole point of the gate is that a missing prod secret (the
 * ALBUM_UPLOAD_TICKET_SECRET outage) fails the BUILD, not every upload at runtime.
 */
import { describe, it, expect } from "vitest";
import { REQUIRED, RECOMMENDED, shouldEnforce, checkEnv } from "../scripts/check-env.mjs";

/** A minimal env with every REQUIRED var present (durable-deploy shape). */
function fullEnv(): Record<string, string> {
  const env: Record<string, string> = { VERCEL: "1" };
  for (const { name } of REQUIRED) env[name] = `value-for-${name}`;
  return env;
}

describe("checkEnv", () => {
  it("passes when every required var is present and non-empty", () => {
    const result = checkEnv(fullEnv());
    expect(result.ok).toBe(true);
    expect(result.missingRequired).toEqual([]);
  });

  it("fails and names ALBUM_UPLOAD_TICKET_SECRET when it is missing (the outage)", () => {
    const env = fullEnv();
    delete env.ALBUM_UPLOAD_TICKET_SECRET;
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
    expect(result.missingRequired.map((m) => m.name)).toContain("ALBUM_UPLOAD_TICKET_SECRET");
    // The rationale rides along so the build log is self-explanatory.
    const entry = result.missingRequired.find((m) => m.name === "ALBUM_UPLOAD_TICKET_SECRET");
    expect(entry?.why).toBeTruthy();
  });

  it("treats an empty/whitespace value as missing", () => {
    const env = fullEnv();
    env.R2_BUCKET = "   ";
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
    expect(result.missingRequired.map((m) => m.name)).toContain("R2_BUCKET");
  });

  it("lists every missing required var, not just the first", () => {
    const env = fullEnv();
    delete env.R2_ACCESS_KEY_ID;
    delete env.R2_SECRET_ACCESS_KEY;
    delete env.GROQ_API_KEY;
    const names = checkEnv(env).missingRequired.map((m) => m.name);
    expect(names).toEqual(
      expect.arrayContaining(["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "GROQ_API_KEY"]),
    );
    expect(names).toHaveLength(3);
  });

  it("reports missing RECOMMENDED vars separately and never fails on them", () => {
    const env = fullEnv(); // required all present, recommended all absent
    const result = checkEnv(env);
    expect(result.ok).toBe(true);
    expect(result.missingRecommended.map((m) => m.name)).toEqual(
      expect.arrayContaining(RECOMMENDED.map((r) => r.name)),
    );
  });
});

describe("checkEnv on Vercel Preview (VERCEL_ENV=preview)", () => {
  /** Full env minus the preview-optional INNGEST keys, tagged as a preview build. */
  function previewEnvWithoutInngest(): Record<string, string> {
    const env = fullEnv();
    env.VERCEL_ENV = "preview";
    delete env.INNGEST_EVENT_KEY;
    delete env.INNGEST_SIGNING_KEY;
    return env;
  }

  it("downgrades the INNGEST_* keys to warn-only — a missing one does NOT fail the build", () => {
    const result = checkEnv(previewEnvWithoutInngest());
    expect(result.ok).toBe(true);
    const requiredNames = result.missingRequired.map((m) => m.name);
    expect(requiredNames).not.toContain("INNGEST_EVENT_KEY");
    expect(requiredNames).not.toContain("INNGEST_SIGNING_KEY");
  });

  it("still surfaces the missing INNGEST_* keys as recommended (warn) on preview", () => {
    const recommendedNames = checkEnv(previewEnvWithoutInngest()).missingRecommended.map((m) => m.name);
    expect(recommendedNames).toEqual(
      expect.arrayContaining(["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]),
    );
  });

  it("still hard-fails on a non-preview-optional required var (e.g. DATABASE_URL) on preview", () => {
    const env = previewEnvWithoutInngest();
    delete env.DATABASE_URL;
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
    expect(result.missingRequired.map((m) => m.name)).toContain("DATABASE_URL");
  });
});

describe("checkEnv on Vercel Production (VERCEL_ENV=production)", () => {
  it("still REQUIRES the INNGEST_* keys — a missing one fails the build", () => {
    const env = fullEnv();
    env.VERCEL_ENV = "production";
    delete env.INNGEST_EVENT_KEY;
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
    expect(result.missingRequired.map((m) => m.name)).toContain("INNGEST_EVENT_KEY");
  });
});

describe("shouldEnforce", () => {
  it("enforces on a Vercel build", () => {
    expect(shouldEnforce({ VERCEL: "1" })).toBe(true);
  });

  it("enforces when a durable DATABASE_URL is present", () => {
    expect(shouldEnforce({ DATABASE_URL: "postgres://x" })).toBe(true);
  });

  it("does NOT enforce on a bare local build (no VERCEL, no DATABASE_URL)", () => {
    expect(shouldEnforce({})).toBe(false);
  });
});
