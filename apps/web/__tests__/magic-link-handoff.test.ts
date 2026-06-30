/**
 * Unit tests for the widened `establishAccountSession` seam (ADR-0003, Slice 2 Task A).
 *
 * The magic-link login is realized differently per adapter, and the seam now returns a
 * discriminated result so the route never branches on `isClerkConfigured()`:
 *   - mock/dev → set a server cookie → `{ kind: "established" }`.
 *   - Clerk    → mint a one-time sign-in token (ticket) → `{ kind: "handoff", ticket }`,
 *     because Clerk forbids forging a server-side session from a userId.
 *
 * Clerk's `signInTokens.createSignInToken` is injected as a stub (`mint` seam) so these tests
 * never import @clerk/nextjs or hit the network. The DB is a real PGlite instance via
 * @chronicle/db's test helper — `resolveAuthProviderUserId` is a real Drizzle join we want to
 * exercise for real (the failure mode is "the join is wrong", not "the mock looks plausible").
 *
 * next/headers is mocked because these modules transitively import server-only; the helpers
 * under test that we assert on never touch cookies (the mock adapter's cookie-set is covered
 * elsewhere — here we assert only the returned kind).
 */
import { describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { createAccountWithPerson } from "@chronicle/core";
import type { Database } from "@chronicle/db";
import {
  createClerkAuthProvider,
  resolveAuthProviderUserId,
} from "../lib/auth-clerk";
import { mintSignInToken, type MintSignInToken } from "../lib/clerk-server";
import { createMockAuthProvider } from "../lib/auth-mock";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

describe("mintSignInToken", () => {
  it("delegates to the injected mint and returns its token (no real Clerk)", async () => {
    let seenUserId = "";
    const mint: MintSignInToken = async (userId) => {
      seenUserId = userId;
      return "ticket_abc";
    };
    const token = await mintSignInToken("clerk_user_1", { mint });
    expect(token).toBe("ticket_abc");
    expect(seenUserId).toBe("clerk_user_1");
  });
});

describe("resolveAuthProviderUserId", () => {
  it("returns the Clerk userId for a Person WITH an Account", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk_has_account",
      email: "kin@example.com",
      displayName: "Kin Folk",
    });
    await expect(resolveAuthProviderUserId(db, personId)).resolves.toBe(
      "clerk_has_account",
    );
  });

  it("returns null for a Person with NO Account", async () => {
    const db = await createTestDatabase();
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Loner", spokenName: "Loner" })
      .returning({ id: persons.id });
    await expect(resolveAuthProviderUserId(db, person!.id)).resolves.toBeNull();
  });

  it("returns null for an unknown personId", async () => {
    const db = await createTestDatabase();
    await expect(
      resolveAuthProviderUserId(db, "00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeNull();
  });
});

describe("Clerk adapter establishAccountSession (handoff)", () => {
  it("mints a ticket for the Account's userId and returns { kind: 'handoff', ticket }", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk_handoff_user",
      email: "handoff@example.com",
      displayName: "Hand Off",
    });

    let mintedFor = "";
    const mint: MintSignInToken = async (userId) => {
      mintedFor = userId;
      return "ticket_xyz";
    };
    const provider = createClerkAuthProvider(db, { mint });

    const result = await provider.establishAccountSession(personId);
    expect(result).toEqual({ kind: "handoff", ticket: "ticket_xyz" });
    expect(mintedFor).toBe("clerk_handoff_user");
  });

  it("throws for a Person with no Account to sign in as", async () => {
    const db = await createTestDatabase();
    const [person] = await db
      .insert(persons)
      .values({ displayName: "No Account", spokenName: "No" })
      .returning({ id: persons.id });
    const mint: MintSignInToken = async () => "unused";
    const provider = createClerkAuthProvider(db, { mint });

    await expect(
      provider.establishAccountSession(person!.id),
    ).rejects.toThrow(/no Clerk Account/);
  });
});

describe("mock adapter establishAccountSession (established)", () => {
  it("returns { kind: 'established' } for a Person WITH an Account", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "mock:user-1",
      email: "mock@example.com",
      displayName: "Mock User",
    });
    const provider = createMockAuthProvider(db);
    await expect(provider.establishAccountSession(personId)).resolves.toEqual({
      kind: "established",
    });
  });
});
