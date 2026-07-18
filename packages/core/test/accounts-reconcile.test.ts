/**
 * Regression tests for the Clerk-webhook reconcilers (issue #10): syncing provider-side
 * `user.updated` / `user.deleted` back onto our Account/Person so a rename or deletion in the auth
 * provider does not leave a stale row.
 *
 * Load-bearing properties exercised here:
 *   - `reconcileAccountProfile` propagates a renamed name to BOTH the Account mirror and the
 *     controlled Person, updates email, and NEVER clobbers the user-owned `spokenName`.
 *   - a blank/absent field is a leave-untouched no-op (never blanks a good stored value).
 *   - `deactivateAccountByAuthProviderUserId` soft-deletes (active=false) and PRESERVES the Person.
 *   - both are idempotent (replay-safe) and report `matched: false` for an unknown provider id.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { accounts, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAccountWithPerson,
  deactivateAccountByAuthProviderUserId,
  reconcileAccountProfile,
} from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function accountRow(authProviderUserId: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.authProviderUserId, authProviderUserId))
    .limit(1);
  return row;
}

async function personRow(personId: string) {
  const [row] = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
  return row;
}

describe("reconcileAccountProfile", () => {
  it("propagates a renamed name to the Account mirror AND the controlled Person", async () => {
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk:u1",
      provider: "clerk",
      emailVerified: true,
      email: "sofia@example.com",
      displayName: "Sofia Esposito",
    });

    const result = await reconcileAccountProfile(db, {
      authProviderUserId: "clerk:u1",
      email: "sofia.new@example.com",
      displayName: "Sofia Marino",
    });

    expect(result).toEqual({ matched: true, personId });
    const acct = await accountRow("clerk:u1");
    expect(acct?.displayName).toBe("Sofia Marino");
    expect(acct?.email).toBe("sofia.new@example.com");
    const person = await personRow(personId);
    expect(person?.displayName).toBe("Sofia Marino");
  });

  it("never clobbers the user-owned spokenName", async () => {
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk:u2",
      provider: "clerk",
      emailVerified: true,
      email: "s@example.com",
      displayName: "Salvatore",
      spokenName: "Sal",
    });

    await reconcileAccountProfile(db, {
      authProviderUserId: "clerk:u2",
      displayName: "Salvatore Marino",
    });

    const person = await personRow(personId);
    expect(person?.displayName).toBe("Salvatore Marino");
    expect(person?.spokenName).toBe("Sal"); // untouched
  });

  it("leaves a stored value untouched when the incoming field is blank/absent", async () => {
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk:u3",
      provider: "clerk",
      emailVerified: true,
      email: "keep@example.com",
      displayName: "Keep Me",
    });

    await reconcileAccountProfile(db, {
      authProviderUserId: "clerk:u3",
      email: "   ",
      displayName: "",
    });

    const acct = await accountRow("clerk:u3");
    expect(acct?.email).toBe("keep@example.com");
    expect(acct?.displayName).toBe("Keep Me");
    const person = await personRow(personId);
    expect(person?.displayName).toBe("Keep Me");
  });

  it("is idempotent under replay", async () => {
    await createAccountWithPerson(db, {
      authProviderUserId: "clerk:u4",
      provider: "clerk",
      emailVerified: true,
      email: "a@example.com",
      displayName: "Ann",
    });
    const input = {
      authProviderUserId: "clerk:u4",
      email: "ann@example.com",
      displayName: "Ann Marino",
    };
    const first = await reconcileAccountProfile(db, input);
    const second = await reconcileAccountProfile(db, input);
    expect(second).toEqual(first);
    const acct = await accountRow("clerk:u4");
    expect(acct?.displayName).toBe("Ann Marino");
    expect(acct?.email).toBe("ann@example.com");
  });

  it("reports matched:false for an unknown provider id", async () => {
    expect(await reconcileAccountProfile(db, { authProviderUserId: "clerk:nope" })).toEqual({
      matched: false,
    });
  });
});

describe("deactivateAccountByAuthProviderUserId", () => {
  it("soft-deletes the account (active=false) and preserves the Person", async () => {
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk:d1",
      provider: "clerk",
      emailVerified: true,
      email: "d@example.com",
      displayName: "Dana",
    });

    const result = await deactivateAccountByAuthProviderUserId(db, "clerk:d1");
    expect(result).toEqual({ matched: true, personId });

    const acct = await accountRow("clerk:d1");
    expect(acct?.active).toBe(false);
    // Person row still exists and is untouched — only the login was severed.
    const person = await personRow(personId);
    expect(person?.displayName).toBe("Dana");
  });

  it("is idempotent (deactivating an already-inactive account is a no-op)", async () => {
    await createAccountWithPerson(db, {
      authProviderUserId: "clerk:d2",
      provider: "clerk",
      emailVerified: true,
      email: "d2@example.com",
      displayName: "Deb",
    });
    const first = await deactivateAccountByAuthProviderUserId(db, "clerk:d2");
    const second = await deactivateAccountByAuthProviderUserId(db, "clerk:d2");
    expect(second).toEqual(first);
    expect((await accountRow("clerk:d2"))?.active).toBe(false);
  });

  it("reports matched:false for an unknown provider id", async () => {
    expect(await deactivateAccountByAuthProviderUserId(db, "clerk:nope")).toEqual({
      matched: false,
    });
  });
});
