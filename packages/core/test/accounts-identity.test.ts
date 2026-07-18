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
  resolveAccountIdByVerifiedPhone,
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

  it("a second account with an already-VERIFIED email but UNVERIFIED itself is created separately (no contact collision)", async () => {
    // Regression: createAccountWithPerson used to write an unverified contact row (verified_at NULL).
    // Because UNIQUE(kind, value) is unconditional, that row collided with the first account's verified
    // contact and made the second sign-up THROW — which would crash a distinct login instead of giving
    // it its own account, and let an unverified login squat/attack an existing verified email.
    const { personId: ownerPersonId } = await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: "owner_id",
      email: "shared@x.com",
      emailVerified: true,
      displayName: "Real Owner",
    });
    // A different login, same email, but NOT verified → must not collide, must be its own account.
    const { personId: otherPersonId } = await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: "other_id",
      email: "shared@x.com",
      emailVerified: false,
      displayName: "Someone Else",
    });
    expect(otherPersonId).not.toBe(ownerPersonId);
    // The verified email still resolves ONLY to the real owner — the unverified login never adopted it.
    const acctId = await resolveAccountIdByVerifiedEmail(db, "shared@x.com");
    expect(acctId).not.toBeNull();
    expect((await resolveAccountByIdentity(db, "clerk", "owner_id"))?.personId).toBe(ownerPersonId);
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

describe("verified-phone match keys (#121)", () => {
  it("writes a VERIFIED phone contact and resolves it back to the account", async () => {
    await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: "phone_user",
      email: "p@x.com",
      emailVerified: true,
      phone: "+15551234567",
      phoneVerified: true,
      displayName: "Phone User",
    });
    const acctId = await resolveAccountIdByVerifiedPhone(db, "+15551234567");
    expect(acctId).not.toBeNull();
    expect((await resolveAccountByIdentity(db, "clerk", "phone_user"))?.personId).toBeTruthy();
  });

  it("an UNVERIFIED phone is NOT a match key (never even stored)", async () => {
    await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: "unv_phone_user",
      email: "up@x.com",
      emailVerified: true,
      phone: "+15557654321",
      phoneVerified: false,
      displayName: "Unv Phone User",
    });
    expect(await resolveAccountIdByVerifiedPhone(db, "+15557654321")).toBeNull();
  });

  it("an unverified phone does not collide with the real owner's verified phone", async () => {
    // Mirrors the email regression above: UNIQUE(kind, value) is unconditional, so an unverified
    // phone written as a row would break the real owner's verified contact.
    const { personId: ownerPersonId } = await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: "phone_owner",
      email: "owner@x.com",
      emailVerified: true,
      phone: "+15550001111",
      phoneVerified: true,
      displayName: "Phone Owner",
    });
    const { personId: otherPersonId } = await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: "phone_other",
      email: "other@x.com",
      emailVerified: true,
      phone: "+15550001111",
      phoneVerified: false,
      displayName: "Someone Else",
    });
    expect(otherPersonId).not.toBe(ownerPersonId);
    expect(await resolveAccountIdByVerifiedPhone(db, "+15550001111")).not.toBeNull();
  });
});
