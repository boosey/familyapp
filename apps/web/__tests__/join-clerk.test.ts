/**
 * Unit tests for the Clerk-path server action helper used by /join/[token].
 *
 * `beginClerkJoinAction` is exported from lib/join-actions so it can be tested in isolation —
 * it is the pure logic that the `beginClerkJoin` server action in the page wraps. The Next.js
 * App Router page itself is an RSC and cannot be imported in vitest.
 *
 * Two seams are mocked:
 *   1. `next/headers` cookies() — replaced with an in-memory jar (same pattern as auth-mock.test.ts).
 *   2. `next/navigation` redirect() — captured instead of thrown, so we can assert the destination.
 *
 * We also exercise the `isClerkConfigured()` branch-condition via env stubs to confirm the
 * gating function reads the right keys — the page uses it to choose which anonymous form to render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_INVITE_COOKIE } from "../lib/pending-invite";
import { isClerkConfigured } from "../lib/clerk-config";

// ── Cookie jar mock ──────────────────────────────────────────────────────────────────────────────
// In-memory jar shared across mocks. Reset in beforeEach.
let jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

// ── Redirect mock ────────────────────────────────────────────────────────────────────────────────
// next/navigation redirect() normally throws a special NEXT_REDIRECT error (it is the mechanism
// by which the framework aborts the current render). We replicate that throw so callers that
// await the action can detect the redirect via .rejects, and we capture the URL side-channel.
let lastRedirect: string | undefined;

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    lastRedirect = url;
    // Mimic the actual Next.js redirect throw shape so call-sites can distinguish it.
    const err = new Error(`NEXT_REDIRECT: ${url}`);
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307`;
    throw err;
  },
}));

// ── Lifecycle ────────────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jar = new Map();
  lastRedirect = undefined;
});

// Import AFTER mocks are declared so vi.mock hoisting takes effect.
import { beginClerkJoinAction } from "../lib/join-actions";

// ── beginClerkJoinAction ─────────────────────────────────────────────────────────────────────────
describe("beginClerkJoinAction", () => {
  it("sets the pending-invite cookie with the right JSON shape and redirects to /sign-up", async () => {
    await expect(
      beginClerkJoinAction("tok-abc123", "Rosa's father"),
    ).rejects.toThrow("NEXT_REDIRECT");

    const raw = jar.get(PENDING_INVITE_COOKIE);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!)).toEqual({
      token: "tok-abc123",
      relationshipLabel: "Rosa's father",
    });
    expect(lastRedirect).toBe("/sign-up");
  });

  it("omits relationshipLabel from the cookie when undefined", async () => {
    await expect(beginClerkJoinAction("tok-xyz", undefined)).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    const raw = jar.get(PENDING_INVITE_COOKIE);
    expect(raw).toBeDefined();
    const parsed: unknown = JSON.parse(raw!);
    expect(parsed).toMatchObject({ token: "tok-xyz" });
    // relationshipLabel must not appear at all (setPendingInvite omits undefined keys).
    expect((parsed as Record<string, unknown>).relationshipLabel).toBeUndefined();
    expect(lastRedirect).toBe("/sign-up");
  });

  it("always redirects to /sign-up regardless of whether a label is supplied", async () => {
    await expect(beginClerkJoinAction("tok-minimal", undefined)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(lastRedirect).toBe("/sign-up");
  });

  it("sets the cookie BEFORE throwing the redirect (cookie survives the throw)", async () => {
    // The cookie must be persisted before the redirect throw — if the order were reversed the
    // cookie would never be written and /auth/callback would find no pending invite.
    await expect(beginClerkJoinAction("tok-order", "gran")).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(jar.has(PENDING_INVITE_COOKIE)).toBe(true);
    expect(lastRedirect).toBe("/sign-up");
  });
});

// ── isClerkConfigured — guards the anonymous branch choice in the page ───────────────────────────
describe("isClerkConfigured (gate for /join anonymous branch)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when keys are absent — anonymous visitor sees the mock sign-up form", () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    expect(isClerkConfigured()).toBe(false);
  });

  it("returns false when keys are placeholder strings — prevents accidental Clerk activation", () => {
    vi.stubEnv("CLERK_SECRET_KEY", "test");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_anything");
    expect(isClerkConfigured()).toBe(false);
  });

  it("returns true with valid sk_test_ + pk_test_ prefixes — anonymous visitor sees Clerk form", () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_abcdef1234567890");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_abcdef1234567890");
    expect(isClerkConfigured()).toBe(true);
  });
});
