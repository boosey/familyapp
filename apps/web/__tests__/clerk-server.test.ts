/**
 * Regression tests for the Clerk Backend-API bridge (lib/clerk-server.ts) — the JIT-provisioning
 * core of ADR-0005.
 *
 * The Clerk `users.getUser` call is injected as a stub (the `getClerkUser` seam) so these tests
 * never import @clerk/nextjs or hit the network. The DB is a real PGlite instance — we exercise the
 * actual `createAccountWithPerson` / `resolveAccountByIdentity` Drizzle path, because the properties
 * we care about (idempotency, the concurrent-landing race resolving to ONE identity, verified-email
 * account linking) are real database behaviors, not mock theater.
 *
 * next/headers is mocked because clerk-server transitively imports server-only modules; the helpers
 * under test never touch cookies.
 */
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "@chronicle/db";
import { createAccountWithPerson } from "@chronicle/core";
import { accounts, persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import {
  clerkDisplayName,
  provisionOrResolveClerkUser,
  type ClerkUserLite,
  type GetClerkUser,
} from "../lib/clerk-server";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

function clerkUser(over: Partial<ClerkUserLite> & { id: string }): ClerkUserLite {
  const base = {
    firstName: "Ada",
    lastName: "Lovelace",
    primaryEmailAddress: { emailAddress: "ada@example.com" },
  };
  const merged = { ...base, ...over };
  return {
    ...merged,
    emailAddresses:
      over.emailAddresses ??
      (merged.primaryEmailAddress
        ? [{ emailAddress: merged.primaryEmailAddress.emailAddress, verified: true }]
        : []),
  };
}

async function countAccounts(db: Database, userId: string): Promise<number> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.authProviderUserId, userId));
  return rows.length;
}

describe("provisionOrResolveClerkUser — JIT provisioning (ADR-0005)", () => {
  it("provisions a brand-new Account+Person from the Clerk user on first landing", async () => {
    const db = await createTestDatabase();
    const getClerkUser: GetClerkUser = async (id) => clerkUser({ id });

    const personId = await provisionOrResolveClerkUser(db, "clerk_new_1", {
      getClerkUser,
    });

    expect(personId).toBeTruthy();
    expect(await countAccounts(db, "clerk_new_1")).toBe(1);
  });

  it("is idempotent: a second landing returns the SAME Person and creates no second Account", async () => {
    const db = await createTestDatabase();
    const getClerkUser: GetClerkUser = async (id) => clerkUser({ id });

    const first = await provisionOrResolveClerkUser(db, "clerk_dup", { getClerkUser });
    const second = await provisionOrResolveClerkUser(db, "clerk_dup", { getClerkUser });

    expect(second).toBe(first);
    expect(await countAccounts(db, "clerk_dup")).toBe(1);
  });

  it("idempotent fast-path does NOT call Clerk again once provisioned", async () => {
    const db = await createTestDatabase();
    let calls = 0;
    const getClerkUser: GetClerkUser = async (id) => {
      calls += 1;
      return clerkUser({ id });
    };

    await provisionOrResolveClerkUser(db, "clerk_fastpath", { getClerkUser });
    await provisionOrResolveClerkUser(db, "clerk_fastpath", { getClerkUser });

    // Second call finds the existing Person before ever reaching out to Clerk.
    expect(calls).toBe(1);
  });

  it("concurrent landings for the same new user resolve to ONE identity (race-safe)", async () => {
    const db = await createTestDatabase();
    const getClerkUser: GetClerkUser = async (id) => clerkUser({ id });

    // Two simultaneous /auth/callback hits: both read "no Person yet", both try to create. The
    // in-transaction uniqueness guard makes the loser re-resolve the winner's Person — never fork.
    const [a, b] = await Promise.all([
      provisionOrResolveClerkUser(db, "clerk_race", { getClerkUser }),
      provisionOrResolveClerkUser(db, "clerk_race", { getClerkUser }),
    ]);

    expect(a).toBe(b);
    expect(await countAccounts(db, "clerk_race")).toBe(1);
  });

  it("re-resolves to the existing Person when a competitor provisions mid-fetch (catch path)", async () => {
    const db = await createTestDatabase();
    // The stub simulates the winning concurrent landing committing WHILE we are fetching the Clerk
    // user: by the time our createAccountWithPerson runs, the row already exists, so it throws and
    // the catch must re-resolve to the competitor's Person rather than surfacing the error.
    let winnerPersonId = "";
    const getClerkUser: GetClerkUser = async (id) => {
      if (!winnerPersonId) {
        const { createAccountWithPerson } = await import("@chronicle/core");
        const created = await createAccountWithPerson(db, {
          authProviderUserId: id,
          provider: "clerk",
          emailVerified: true,
          email: "winner@example.com",
          displayName: "Winner Landing",
        });
        winnerPersonId = created.personId;
      }
      return clerkUser({ id });
    };

    const resolved = await provisionOrResolveClerkUser(db, "clerk_midfetch", { getClerkUser });
    expect(resolved).toBe(winnerPersonId);
    expect(await countAccounts(db, "clerk_midfetch")).toBe(1);
  });

  it("STEP 2: unknown vendor id + verified matching email attaches to the existing account", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      provider: "clerk", authProviderUserId: "dev_zzz",
      email: "zach@x.com", emailVerified: true, displayName: "Zach B",
    });
    const stub: GetClerkUser = async (_id) => ({
      id: "prod_zzz", firstName: "Zach", lastName: "B",
      primaryEmailAddress: { emailAddress: "zach@x.com" },
      emailAddresses: [{ emailAddress: "zach@x.com", verified: true }],
    });
    const resolved = await provisionOrResolveClerkUser(db, "prod_zzz", { getClerkUser: stub });
    expect(resolved).toBe(personId); // SAME person, no duplicate
  });

  it("SECURITY: unknown vendor id + UNVERIFIED matching email does NOT attach — new account", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      provider: "clerk", authProviderUserId: "dev_www",
      email: "eve@x.com", emailVerified: true, displayName: "Eve",
    });
    const attacker: GetClerkUser = async (_id) => ({
      id: "prod_attacker", firstName: "Not", lastName: "Eve",
      primaryEmailAddress: { emailAddress: "eve@x.com" },
      emailAddresses: [{ emailAddress: "eve@x.com", verified: false }], // UNVERIFIED
    });
    const resolved = await provisionOrResolveClerkUser(db, "prod_attacker", { getClerkUser: attacker });
    expect(resolved).not.toBe(personId); // a SEPARATE account, no takeover
  });

  it("STEP 1: a known vendor id fast-paths to its person with no Clerk fetch", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      provider: "clerk", authProviderUserId: "known_id",
      email: "k@x.com", emailVerified: true, displayName: "Kay",
    });
    const stub: GetClerkUser = async (_id) => { throw new Error("must not fetch Clerk on fast path"); };
    expect(await provisionOrResolveClerkUser(db, "known_id", { getClerkUser: stub })).toBe(personId);
  });

  it("uses the Clerk first/last name as the displayName for the new Person", async () => {
    const db = await createTestDatabase();
    const getClerkUser: GetClerkUser = async (id) =>
      clerkUser({ id, firstName: "Grace", lastName: "Hopper" });

    const personId = await provisionOrResolveClerkUser(db, "clerk_named", { getClerkUser });
    const [row] = await db
      .select({ displayName: persons.displayName, spokenName: persons.spokenName })
      .from(persons)
      .where(eq(persons.id, personId));
    expect(row?.displayName).toBe("Grace Hopper");
    expect(row?.spokenName).toBe("Grace"); // first word default
  });
});

describe("clerkDisplayName — fallback ladder", () => {
  it("prefers 'First Last'", () => {
    expect(
      clerkDisplayName(clerkUser({ id: "x", firstName: "Ada", lastName: "Lovelace" })),
    ).toBe("Ada Lovelace");
  });

  it("uses just the first name when last is missing", () => {
    expect(
      clerkDisplayName(clerkUser({ id: "x", firstName: "Ada", lastName: null })),
    ).toBe("Ada");
  });

  it("falls back to the email local-part when no name is present", () => {
    expect(
      clerkDisplayName({
        id: "x",
        firstName: null,
        lastName: null,
        primaryEmailAddress: { emailAddress: "grace.hopper@navy.mil" },
        emailAddresses: [{ emailAddress: "grace.hopper@navy.mil", verified: true }],
      }),
    ).toBe("grace.hopper");
  });

  it("falls back to a generic label when neither name nor email exists", () => {
    expect(
      clerkDisplayName({
        id: "x",
        firstName: null,
        lastName: null,
        primaryEmailAddress: null,
        emailAddresses: [],
      }),
    ).toBe("Family member");
  });
});
