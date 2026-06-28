/**
 * Unit tests for the mock AuthProvider — the local stand-in for Clerk's user store.
 *
 * The DB is a real PGlite instance via @chronicle/db's test helper, so we exercise the actual
 * Drizzle query paths (the failures we care about are "the accounts→persons join is wrong" or "a
 * schema field was renamed", not "my mock looks plausible").
 *
 * next/headers `cookies()` isn't available outside a request, so we mock it with an in-memory jar.
 * The hash helpers and the DB-backed credential lookup are pure of that context and tested directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { accounts, mockAuthUsers, persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import * as core from "@chronicle/core";

// In-memory cookie jar shared by the next/headers mock. Reset before each test.
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
  DEV_MOCK_SESSION_COOKIE,
  createMockAuthProvider,
  hashPassword,
  mockSignIn,
  mockSignOut,
  seedMockCredential,
  verifyPassword,
} from "../lib/auth-mock";

// TASK 2's core write path. Until it lands, the signUp full-flow test self-skips.
const hasCreateAccountWithPerson =
  typeof (core as Record<string, unknown>).createAccountWithPerson ===
  "function";

/** Manually wire an Account→Person for a given provider id (what createAccountWithPerson will do). */
async function seedAccountPerson(
  db: Database,
  authProviderUserId: string,
  email = "kin@example.com",
): Promise<string> {
  const [account] = await db
    .insert(accounts)
    .values({ authProviderUserId, email })
    .returning({ id: accounts.id });
  const [person] = await db
    .insert(persons)
    .values({ displayName: "Kin Folk", spokenName: "Kin", accountId: account!.id })
    .returning({ id: persons.id });
  return person!.id;
}

beforeEach(() => {
  jar = new Map();
});

describe("hashPassword / verifyPassword", () => {
  it("round-trips and produces the documented scrypt$salt$hash format", () => {
    const stored = hashPassword("correct horse");
    expect(stored).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(verifyPassword("correct horse", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("correct horse");
    expect(verifyPassword("battery staple", stored)).toBe(false);
  });

  it("rejects malformed stored strings instead of throwing", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "notscrypt$aa$bb")).toBe(false);
    expect(verifyPassword("x", "scrypt$onlytwo")).toBe(false);
    expect(verifyPassword("x", "scrypt$$")).toBe(false);
  });

  it("uses a fresh salt per call (same password → different stored value)", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });
});

describe("createMockAuthProvider.getCurrentAuthContext", () => {
  it("returns anonymous with no session cookie", async () => {
    const db = await createTestDatabase();
    const provider = createMockAuthProvider(db);
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("resolves the cookie's provider id → Account → Person", async () => {
    const db = await createTestDatabase();
    const personId = await seedAccountPerson(db, "mock:abc");
    jar.set(DEV_MOCK_SESSION_COOKIE, "mock:abc");
    const provider = createMockAuthProvider(db);
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "account",
      personId,
    });
  });

  it("degrades to anonymous for a stale cookie with no matching Account", async () => {
    const db = await createTestDatabase();
    await seedAccountPerson(db, "mock:someone-else");
    jar.set(DEV_MOCK_SESSION_COOKIE, "mock:ghost");
    const provider = createMockAuthProvider(db);
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("degrades to anonymous when an Account has no Person (orphan)", async () => {
    const db = await createTestDatabase();
    await db
      .insert(accounts)
      .values({ authProviderUserId: "mock:orphan", email: "o@example.com" });
    jar.set(DEV_MOCK_SESSION_COOKIE, "mock:orphan");
    const provider = createMockAuthProvider(db);
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "anonymous",
    });
  });
});

describe("mockSignIn", () => {
  it("signs in with the right password and sets the session cookie", async () => {
    const db = await createTestDatabase();
    const personId = await seedAccountPerson(db, "mock:sofia", "sofia@example.com");
    await seedMockCredential(db, {
      email: "sofia@example.com",
      password: "password",
      authProviderUserId: "mock:sofia",
    });

    const result = await mockSignIn(db, {
      email: "sofia@example.com",
      password: "password",
    });
    expect(result).toEqual({ ok: true, personId });
    expect(jar.get(DEV_MOCK_SESSION_COOKIE)).toBe("mock:sofia");

    // And the freshly-set cookie resolves through the provider.
    const provider = createMockAuthProvider(db);
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "account",
      personId,
    });
  });

  it("rejects a wrong password without setting a cookie", async () => {
    const db = await createTestDatabase();
    await seedAccountPerson(db, "mock:sofia", "sofia@example.com");
    await seedMockCredential(db, {
      email: "sofia@example.com",
      password: "password",
      authProviderUserId: "mock:sofia",
    });

    const result = await mockSignIn(db, {
      email: "sofia@example.com",
      password: "wrong",
    });
    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
    expect(jar.has(DEV_MOCK_SESSION_COOKIE)).toBe(false);
  });

  it("rejects an unknown email (same opaque error, no enumeration)", async () => {
    const db = await createTestDatabase();
    const result = await mockSignIn(db, {
      email: "nobody@example.com",
      password: "password",
    });
    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
  });

  it("normalizes email case/whitespace on sign-in", async () => {
    const db = await createTestDatabase();
    await seedAccountPerson(db, "mock:sofia", "sofia@example.com");
    await seedMockCredential(db, {
      email: "Sofia@Example.com ",
      password: "password",
      authProviderUserId: "mock:sofia",
    });
    const result = await mockSignIn(db, {
      email: "  SOFIA@example.com",
      password: "password",
    });
    expect(result).toEqual({ ok: true, personId: expect.any(String) });
  });
});

describe("mockSignOut", () => {
  it("clears the session cookie → provider returns anonymous", async () => {
    const db = await createTestDatabase();
    const personId = await seedAccountPerson(db, "mock:sofia", "sofia@example.com");
    jar.set(DEV_MOCK_SESSION_COOKIE, "mock:sofia");

    const provider = createMockAuthProvider(db);
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "account",
      personId,
    });

    await mockSignOut();
    expect(jar.has(DEV_MOCK_SESSION_COOKIE)).toBe(false);
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "anonymous",
    });
  });
});

describe("seedMockCredential", () => {
  it("rejects a duplicate email via the unique index", async () => {
    const db = await createTestDatabase();
    await seedMockCredential(db, {
      email: "dup@example.com",
      password: "a",
      authProviderUserId: "mock:1",
    });
    await expect(
      seedMockCredential(db, {
        email: "dup@example.com",
        password: "b",
        authProviderUserId: "mock:2",
      }),
    ).rejects.toThrow();
  });
});

// Full signup flow depends on TASK 2's core.createAccountWithPerson — runs automatically once it lands.
describe.skipIf(!hasCreateAccountWithPerson)("mockSignUp (needs core)", () => {
  it("signs up → session cookie resolves to the new Person (onboarded_at NULL)", async () => {
    const { mockSignUp } = await import("../lib/auth-mock");
    const db = await createTestDatabase();

    const result = await mockSignUp(db, {
      email: "new@example.com",
      password: "password",
      displayName: "New Person",
    });
    expect(result).toEqual({ ok: true, personId: expect.any(String) });

    const provider = createMockAuthProvider(db);
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "account",
      personId: (result as { ok: true; personId: string }).personId,
    });

    // New person starts un-onboarded so the gate routes them to /welcome.
    const [p] = await db
      .select({ onboardedAt: persons.onboardedAt })
      .from(persons)
      .limit(1);
    expect(p?.onboardedAt).toBeNull();
  });

  it("rejects a second signup with the same email (email_taken)", async () => {
    const { mockSignUp } = await import("../lib/auth-mock");
    const db = await createTestDatabase();
    await mockSignUp(db, {
      email: "taken@example.com",
      password: "password",
      displayName: "First",
    });
    const second = await mockSignUp(db, {
      email: "taken@example.com",
      password: "other",
      displayName: "Second",
    });
    expect(second).toEqual({ ok: false, error: "email_taken" });
    // The collision must not have created a second credential row.
    const rows = await db.select().from(mockAuthUsers);
    expect(rows).toHaveLength(1);
  });

  // Regression: a partial failure used to leave an orphaned credential row that permanently
  // locked the email out. Both writes now share one transaction, so a failure in the
  // Account/Person step rolls the credential back. We force that failure with a whitespace-only
  // displayName (createAccountWithPerson rejects it) AFTER the credential insert.
  it("rolls back the credential row when Account/Person creation fails", async () => {
    const { mockSignUp } = await import("../lib/auth-mock");
    const db = await createTestDatabase();

    const failed = await mockSignUp(db, {
      email: "retry@example.com",
      password: "password",
      displayName: "   ", // whitespace-only → createAccountWithPerson throws → tx rolls back
    });
    expect(failed).toEqual({ ok: false, error: "invalid" });

    // (a) No orphaned credential survived the rollback.
    const orphans = await db.select().from(mockAuthUsers);
    expect(orphans).toHaveLength(0);

    // (b) The same email can still sign up afterward (not permanently locked out).
    const retry = await mockSignUp(db, {
      email: "retry@example.com",
      password: "password",
      displayName: "Retry Person",
    });
    expect(retry).toEqual({ ok: true, personId: expect.any(String) });
  });
});
