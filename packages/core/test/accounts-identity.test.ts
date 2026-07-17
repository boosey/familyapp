/**
 * Tests for the identity/contact resolution primitives (provider-agnostic identity, model B).
 * A vendor identity resolves to its account's Person; a VERIFIED email is a match key while an
 * unverified one is not; and a second vendor id can be attached to an existing account idempotently.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAccountWithPerson,
  resolveAccountByIdentity,
  resolveAccountIdByVerifiedEmail,
  attachIdentity,
} from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("identity/contact resolution", () => {
  it("createAccountWithPerson writes a clerk identity and a verified email contact", async () => {
    const { personId } = await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: "user_1",
      email: "Test@X.com",
      emailVerified: true,
      displayName: "Test User",
    });
    const byId = await resolveAccountByIdentity(db, "clerk", "user_1");
    expect(byId?.personId).toBe(personId);
    const acctId = await resolveAccountIdByVerifiedEmail(db, "test@x.com"); // normalized + verified
    expect(acctId).not.toBeNull();
  });

  it("an UNVERIFIED email is NOT a match key", async () => {
    await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: "user_2",
      email: "unv@x.com",
      emailVerified: false,
      displayName: "Unv User",
    });
    expect(await resolveAccountIdByVerifiedEmail(db, "unv@x.com")).toBeNull();
  });

  it("attachIdentity adds a second vendor id to the same account (idempotent)", async () => {
    const { personId } = await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: "dev_id",
      email: "z@x.com",
      emailVerified: true,
      displayName: "Zed",
    });
    const acctId = await resolveAccountIdByVerifiedEmail(db, "z@x.com");
    await attachIdentity(db, acctId!, "clerk", "prod_id");
    await attachIdentity(db, acctId!, "clerk", "prod_id"); // idempotent, no throw
    expect((await resolveAccountByIdentity(db, "clerk", "prod_id"))?.personId).toBe(personId);
  });
});
