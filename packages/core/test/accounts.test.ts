/**
 * Tests for account creation — the account login surface. The load-bearing properties:
 * the Account+Person pair is created atomically with the single `persons.account_id` FK wired, and
 * a duplicate provider id is rejected (one Account per provider identity).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  InvariantViolation,
  createAccountWithPerson,
  findPersonIdByAuthProviderUserId,
} from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function spokenNameOf(personId: string): Promise<string> {
  const [p] = await db
    .select({ spokenName: persons.spokenName })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  // spokenName is nullable in schema (ADR-0016), but an account-holder always has one.
  return p!.spokenName ?? "";
}

describe("createAccountWithPerson", () => {
  it("creates account + person and wires the account_id FK", async () => {
    const { accountId, personId } = await createAccountWithPerson(db, {
      authProviderUserId: "mock:abc",
      provider: "clerk",
      emailVerified: true,
      email: "sofia@example.com",
      displayName: "Sofia Esposito",
    });
    expect(accountId).toBeTruthy();
    expect(personId).toBeTruthy();

    const resolved = await findPersonIdByAuthProviderUserId(db, "mock:abc");
    expect(resolved).toBe(personId);
  });

  it("defaults spokenName to the first word of displayName", async () => {
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "mock:s1",
      provider: "clerk",
      emailVerified: true,
      email: "s@example.com",
      displayName: "Sofia Maria Esposito",
    });
    expect(await spokenNameOf(personId)).toBe("Sofia");
  });

  it("honors an explicit spokenName", async () => {
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "mock:s2",
      provider: "clerk",
      emailVerified: true,
      email: "s2@example.com",
      displayName: "Salvatore",
      spokenName: "Sal",
    });
    expect(await spokenNameOf(personId)).toBe("Sal");
  });

  it("rejects a duplicate authProviderUserId", async () => {
    await createAccountWithPerson(db, {
      authProviderUserId: "mock:dup",
      provider: "clerk",
      emailVerified: true,
      email: "a@example.com",
      displayName: "Ann",
    });
    await expect(
      createAccountWithPerson(db, {
        authProviderUserId: "mock:dup",
        provider: "clerk",
        emailVerified: true,
        email: "b@example.com",
        displayName: "Bob",
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("rejects an empty display name", async () => {
    await expect(
      createAccountWithPerson(db, {
        authProviderUserId: "mock:empty",
        provider: "clerk",
        emailVerified: true,
        email: "e@example.com",
        displayName: "   ",
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});

describe("findPersonIdByAuthProviderUserId", () => {
  it("returns null for an unknown provider id", async () => {
    expect(await findPersonIdByAuthProviderUserId(db, "mock:nope")).toBeNull();
  });
});
