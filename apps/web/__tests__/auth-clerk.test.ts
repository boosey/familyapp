/**
 * Unit tests for the Clerk-backed AuthProvider adapter.
 *
 * Clerk's `auth()` is injected as a stub so the test never installs/imports @clerk/nextjs and
 * never makes a network call. The DB is a real PGlite instance via @chronicle/db's test helper —
 * we exercise the actual Drizzle query path (the failure mode we care about is "join is wrong"
 * or "schema field renamed", not "my mock looks plausible").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { accounts, persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import { createClerkAuthProvider, type ClerkAuthFn } from "../lib/auth-clerk";
import { isClerkConfigured } from "../lib/clerk-config";
import { config as middlewareConfig } from "../middleware";

async function seedPersonWithAccount(
  db: Database,
  clerkUserId: string,
): Promise<{ personId: string; accountId: string }> {
  const [account] = await db
    .insert(accounts)
    .values({ authProviderUserId: clerkUserId, email: "kin@example.com" })
    .returning({ id: accounts.id });
  const [person] = await db
    .insert(persons)
    .values({
      displayName: "Kin Folk",
      spokenName: "Kin",
      accountId: account!.id,
    })
    .returning({ id: persons.id });
  return { personId: person!.id, accountId: account!.id };
}

describe("createClerkAuthProvider", () => {
  it("returns anonymous when Clerk reports no userId", async () => {
    const db = await createTestDatabase();
    const auth: ClerkAuthFn = async () => ({ userId: null });
    const provider = createClerkAuthProvider(db, { auth });
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("resolves Clerk userId → Account → Person and returns the Person id", async () => {
    const db = await createTestDatabase();
    const { personId } = await seedPersonWithAccount(db, "clerk_user_abc");
    const auth: ClerkAuthFn = async () => ({ userId: "clerk_user_abc" });
    const provider = createClerkAuthProvider(db, { auth });
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "account",
      personId,
    });
  });

  it("degrades to anonymous when Clerk userId has no matching Account (defense in depth)", async () => {
    const db = await createTestDatabase();
    // Seed a different account so the table isn't empty — the lookup must select on the right key.
    await seedPersonWithAccount(db, "someone_else");
    const auth: ClerkAuthFn = async () => ({ userId: "ghost_user" });
    const provider = createClerkAuthProvider(db, { auth });
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("degrades to anonymous when Account exists but no Person points at it (orphan login)", async () => {
    const db = await createTestDatabase();
    await db
      .insert(accounts)
      .values({ authProviderUserId: "orphan_account", email: "o@example.com" });
    const auth: ClerkAuthFn = async () => ({ userId: "orphan_account" });
    const provider = createClerkAuthProvider(db, { auth });
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("degrades to anonymous on Clerk error (never throws)", async () => {
    const db = await createTestDatabase();
    const auth: ClerkAuthFn = async () => {
      throw new Error("clerk exploded");
    };
    const provider = createClerkAuthProvider(db, { auth });
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "anonymous",
    });
  });

  it("degrades to anonymous on DB error (never throws)", async () => {
    // A DB that throws synchronously on .select — emulates a downed Postgres in prod.
    const brokenDb = {
      select() {
        throw new Error("db down");
      },
    } as unknown as Database;
    const auth: ClerkAuthFn = async () => ({ userId: "any_user" });
    const provider = createClerkAuthProvider(brokenDb, { auth });
    // Silence the expected error log so test output stays clean.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "anonymous",
    });
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("auth-clerk"),
      expect.any(Error),
    );
    errSpy.mockRestore();
  });
});

describe("isClerkConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false when CLERK_SECRET_KEY is a non-prefixed placeholder like 'test'", () => {
    // Regression: prior `Boolean(env)` check let `CLERK_SECRET_KEY=test` flip auth on.
    vi.stubEnv("CLERK_SECRET_KEY", "test");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_anything");
    expect(isClerkConfigured()).toBe(false);
  });

  it("returns false when publishable key is a non-prefixed placeholder", () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_anything");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "test");
    expect(isClerkConfigured()).toBe(false);
  });

  it("returns false when either key is unset", () => {
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    expect(isClerkConfigured()).toBe(false);
  });

  it("returns true with valid sk_test_ + pk_test_ prefixes", () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_abcdef1234567890");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_abcdef1234567890");
    expect(isClerkConfigured()).toBe(true);
  });

  it("returns true with valid sk_live_ + pk_live_ prefixes", () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live_abcdef1234567890");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_abcdef1234567890");
    expect(isClerkConfigured()).toBe(true);
  });
});

describe("middleware matcher", () => {
  it("excludes the elder token surface (/s/...) and includes /hub/", () => {
    // Clerk must NEVER intercept the elder token surface — it authenticates by URL token, not
    // by Clerk session, and any redirect/auth flow would break the wedge.
    const serialized = JSON.stringify(middlewareConfig.matcher);
    expect(serialized).not.toContain("/s/");
    expect(serialized).toContain("/hub/");
  });
});
