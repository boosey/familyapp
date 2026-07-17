import { describe, it, expect, beforeEach } from "vitest";
import { accounts, accountIdentities, accountContacts } from "../src/schema";
import { createTestDatabase, type Database } from "../src/index";

describe("account_identities / account_contacts", () => {
  let db: Database;
  beforeEach(async () => {
    db = await createTestDatabase();
  });

  it("stores an identity and enforces (provider, provider_user_id) uniqueness", async () => {
    const [acct] = await db
      .insert(accounts)
      .values({ authProviderUserId: "user_a", email: "a@x.com" })
      .returning();
    await db
      .insert(accountIdentities)
      .values({ accountId: acct!.id, provider: "clerk", providerUserId: "user_a" });
    await expect(
      db
        .insert(accountIdentities)
        .values({ accountId: acct!.id, provider: "clerk", providerUserId: "user_a" }),
    ).rejects.toThrow();
  });

  it("enforces (kind, value) uniqueness on contacts", async () => {
    const [a1] = await db
      .insert(accounts)
      .values({ authProviderUserId: "u1", email: "one@x.com" })
      .returning();
    const [a2] = await db
      .insert(accounts)
      .values({ authProviderUserId: "u2", email: "two@x.com" })
      .returning();
    await db.insert(accountContacts).values({
      accountId: a1!.id,
      kind: "email",
      value: "shared@x.com",
      verifiedAt: new Date(),
    });
    await expect(
      db.insert(accountContacts).values({
        accountId: a2!.id,
        kind: "email",
        value: "shared@x.com",
        verifiedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
