/**
 * Unit tests for the Clerk-backed AuthProvider adapter.
 *
 * Clerk's `auth()` is injected as a stub so the test never installs/imports @clerk/nextjs and
 * never makes a network call. The DB is a real PGlite instance via @chronicle/db's test helper —
 * we exercise the actual Drizzle query path (the failure mode we care about is "join is wrong"
 * or "schema field renamed", not "my mock looks plausible").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "@chronicle/db";
import { accounts, persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import { deactivateAccountByAuthProviderUserId } from "@chronicle/core";
import {
  createClerkAuthProvider,
  resolveAuthProviderUserId,
  type ClerkAuthFn,
} from "../lib/auth-clerk";
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

  it("retries a transient DB failure during the account lookup and stays signed in", async () => {
    // Regression: Neon (prod Postgres) scales to zero; the first query after idle can drop the
    // connection while the compute wakes. That transient throw used to hit the catch and degrade a
    // SIGNED-IN user to anonymous — the spurious "Not signed in" observed in production. The lookup
    // must retry past the blip and resolve to the account.
    const db = await createTestDatabase();
    const { personId } = await seedPersonWithAccount(db, "clerk_flaky");
    let selectCalls = 0;
    const realSelect = db.select.bind(db);
    const flakyDb = new Proxy(db as object, {
      get(target, prop, receiver) {
        if (prop === "select") {
          return (...args: unknown[]) => {
            selectCalls += 1;
            if (selectCalls === 1) {
              // Emulate a Neon cold-start connection drop on the first attempt only.
              throw new Error("Connection terminated unexpectedly");
            }
            return (realSelect as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as Database;
    const auth: ClerkAuthFn = async () => ({ userId: "clerk_flaky" });
    const provider = createClerkAuthProvider(flakyDb, { auth });
    // Silence the expected retry warning so test output stays clean.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "account",
      personId,
    });
    // Proves it actually retried past the transient failure rather than degrading.
    expect(selectCalls).toBeGreaterThanOrEqual(2);
    warnSpy.mockRestore();
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

  it("locks out a SOFT-DELETED account (Clerk user.deleted, issue #10): active=false → anonymous", async () => {
    // The `user.deleted` webhook flips accounts.active=false but preserves the Person. A Clerk session
    // can outlive that event, so getCurrentAuthContext MUST treat the deactivated account as logged out
    // — otherwise the soft-delete is inert and a deleted user keeps full account access.
    const db = await createTestDatabase();
    const { personId } = await seedPersonWithAccount(db, "clerk_deleted");
    const auth: ClerkAuthFn = async () => ({ userId: "clerk_deleted" });
    const provider = createClerkAuthProvider(db, { auth });

    // While active, the account resolves normally.
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "account",
      personId,
    });

    // After the webhook soft-delete, the same live Clerk session resolves to anonymous.
    await deactivateAccountByAuthProviderUserId(db, "clerk_deleted");
    await expect(provider.getCurrentAuthContext()).resolves.toEqual({
      kind: "anonymous",
    });

    // Defense in depth: the magic-link path also refuses a deactivated account (no ticket minted).
    expect(await resolveAuthProviderUserId(db, personId)).toBeNull();

    // The Person row itself is preserved — only the login was severed.
    const [person] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.id, personId))
      .limit(1);
    expect(person?.id).toBe(personId);
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
  it("does not contain a positive /s/ or /a/ entry", () => {
    // Load-bearing invariant: token-bearer surfaces authenticate by URL token, NOT by Clerk
    // session. Clerk must NEVER intercept them — a Clerk redirect would break both the narrator
    // recording wedge (/s/) and the magic-link surface (/a/).
    const serialized = JSON.stringify(middlewareConfig.matcher);
    // No matcher entry may begin with /s/ or /a/ as a positive path match.
    expect(serialized).not.toContain('"/s/');
    expect(serialized).not.toContain('"/a/');
    // Clerk's internal handshake routes must be explicitly covered.
    expect(serialized).toContain("__clerk");
  });

  it("negative-lookahead pattern excludes /s/ and /a/ and matches protected routes", () => {
    // Behaviorally verify the regex: extract the first (lookahead) entry and test it as a regex.
    // Anchor with ^ so we replicate how Next.js tests paths (from the start). Without anchoring,
    // .test("/s/sometoken") would find the inner "/" at position 2 and falsely return true.
    // This catches regressions where someone rewrites the pattern and breaks the carve-outs.
    const firstPattern = (middlewareConfig.matcher as string[])[0]!;
    const re = new RegExp("^" + firstPattern + "$");

    // Must NOT match token-bearer surfaces.
    expect(re.test("/s/sometoken")).toBe(false);
    expect(re.test("/a/sometoken")).toBe(false);

    // Must match protected pages: hub, auth UI routes, auth callback.
    expect(re.test("/hub/dashboard")).toBe(true);
    expect(re.test("/sign-in")).toBe(true);
    expect(re.test("/sign-up")).toBe(true);
    expect(re.test("/auth/callback")).toBe(true);

    // Must NOT match Next.js internals or common static file extensions.
    expect(re.test("/_next/static/chunk.js")).toBe(false);
    expect(re.test("/favicon.ico")).toBe(false);
    expect(re.test("/logo.png")).toBe(false);

    // MUST match /api/media — it calls getCurrentAuthContext(), and in Clerk mode Clerk's auth()
    // only resolves on requests the middleware has processed. The authenticated hub plays media
    // through it; excluding it would break hub playback. (Regression guard for that bug.)
    expect(re.test("/api/media/abc123")).toBe(true);
    expect(re.test("/api/hub/clear-invite-flash")).toBe(true);
    // A page route that merely starts with "a"/"s" but not "a/"/"s/" must stay matched.
    expect(re.test("/settings")).toBe(true);
    expect(re.test("/api-docs")).toBe(true);
  });
});
