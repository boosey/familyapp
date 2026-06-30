/**
 * Regression tests for the pending-invite cookie (lib/pending-invite.ts) — the bridge that carries
 * an in-flight invitation across the Clerk sign-up hop.
 *
 * next/headers `cookies()` isn't available outside a request, so we back it with an in-memory jar
 * (same pattern as auth-mock.test.ts). We exercise the set → read round-trip, the omit-empty-label
 * contract, the clear, and the defensive parse (a malformed / truncated cookie must degrade to null,
 * never throw — a corrupt cookie cannot be allowed to break /auth/callback).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  PENDING_INVITE_COOKIE,
  clearPendingInvite,
  readPendingInvite,
  setPendingInvite,
} from "../lib/pending-invite";

beforeEach(() => {
  jar = new Map();
});

describe("pending-invite cookie round-trip", () => {
  it("sets then reads back the token + relationship label", async () => {
    await setPendingInvite({ token: "tok_abc", relationshipLabel: "granddaughter" });
    await expect(readPendingInvite()).resolves.toEqual({
      token: "tok_abc",
      relationshipLabel: "granddaughter",
    });
  });

  it("omits relationshipLabel when not provided (undefined, not null/empty)", async () => {
    await setPendingInvite({ token: "tok_nolabel" });
    const read = await readPendingInvite();
    expect(read).toEqual({ token: "tok_nolabel" });
    expect(read).not.toHaveProperty("relationshipLabel", null);
    expect(read?.relationshipLabel).toBeUndefined();
  });

  it("clears the cookie → subsequent read is null", async () => {
    await setPendingInvite({ token: "tok_clear" });
    await clearPendingInvite();
    await expect(readPendingInvite()).resolves.toBeNull();
  });

  it("returns null when no cookie is present", async () => {
    await expect(readPendingInvite()).resolves.toBeNull();
  });
});

describe("pending-invite defensive parse (never throws)", () => {
  it("returns null for a non-JSON payload", async () => {
    jar.set(PENDING_INVITE_COOKIE, "not-json{");
    await expect(readPendingInvite()).resolves.toBeNull();
  });

  it("returns null when token is missing", async () => {
    jar.set(PENDING_INVITE_COOKIE, JSON.stringify({ relationshipLabel: "x" }));
    await expect(readPendingInvite()).resolves.toBeNull();
  });

  it("returns null when token is an empty string", async () => {
    jar.set(PENDING_INVITE_COOKIE, JSON.stringify({ token: "" }));
    await expect(readPendingInvite()).resolves.toBeNull();
  });

  it("returns null when token is not a string", async () => {
    jar.set(PENDING_INVITE_COOKIE, JSON.stringify({ token: 42 }));
    await expect(readPendingInvite()).resolves.toBeNull();
  });

  it("drops a non-string relationshipLabel but keeps a valid token", async () => {
    jar.set(
      PENDING_INVITE_COOKIE,
      JSON.stringify({ token: "tok_ok", relationshipLabel: 99 }),
    );
    await expect(readPendingInvite()).resolves.toEqual({ token: "tok_ok" });
  });

  it("caps an over-long relationshipLabel (attacker-influenced cookie)", async () => {
    jar.set(
      PENDING_INVITE_COOKIE,
      JSON.stringify({ token: "tok_ok", relationshipLabel: "x".repeat(5000) }),
    );
    const read = await readPendingInvite();
    expect(read?.token).toBe("tok_ok");
    expect(read?.relationshipLabel?.length).toBe(200);
  });
});
