/**
 * Regression tests for the Clerk-webhook dispatcher (lib/clerk-webhook.ts, issue #10).
 *
 * These drive `applyClerkWebhookEvent` with plain Clerk-shaped payloads (snake_case) against a real
 * PGlite DB — no signature verification, no @clerk/nextjs import, no network. Signature verification
 * itself is Clerk's `verifyWebhook` (exercised only in the thin route handler); the domain effect is
 * what we own and regression-test here.
 *
 * next/headers is mocked because clerk-webhook transitively imports server-only modules (via
 * clerk-server); the code under test never touches cookies.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createTestDatabase, type Database } from "@chronicle/db";
import { accounts, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { attachIdentity, createAccountWithPerson } from "@chronicle/core";
import {
  applyClerkWebhookEvent,
  primaryEmailOf,
  type ClerkUserJson,
} from "../lib/clerk-webhook";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

function userUpdated(over: Partial<ClerkUserJson> & { id: string }) {
  return {
    type: "user.updated",
    data: {
      first_name: "Sofia",
      last_name: "Esposito",
      email_addresses: [{ id: "eml_1", email_address: "sofia@example.com" }],
      primary_email_address_id: "eml_1",
      ...over,
    } satisfies ClerkUserJson,
  };
}

async function acct(authProviderUserId: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.authProviderUserId, authProviderUserId))
    .limit(1);
  return row;
}
async function person(personId: string) {
  const [row] = await db.select().from(persons).where(eq(persons.id, personId)).limit(1);
  return row;
}

describe("primaryEmailOf", () => {
  it("resolves the address flagged primary", () => {
    expect(
      primaryEmailOf({
        id: "u",
        email_addresses: [
          { id: "a", email_address: "one@x.com" },
          { id: "b", email_address: "two@x.com" },
        ],
        primary_email_address_id: "b",
      }),
    ).toBe("two@x.com");
  });
  it("falls back to the first address, then null", () => {
    expect(
      primaryEmailOf({ id: "u", email_addresses: [{ id: "a", email_address: "one@x.com" }] }),
    ).toBe("one@x.com");
    expect(primaryEmailOf({ id: "u" })).toBeNull();
  });
});

describe("applyClerkWebhookEvent — user.updated", () => {
  it("reconciles a rename + email onto the Account and Person", async () => {
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk:w1",
      provider: "clerk",
      emailVerified: true,
      email: "old@example.com",
      displayName: "Sofia Esposito",
    });

    const outcome = await applyClerkWebhookEvent(
      db,
      userUpdated({
        id: "clerk:w1",
        first_name: "Sofia",
        last_name: "Marino",
        email_addresses: [{ id: "eml_1", email_address: "sofia.marino@example.com" }],
        primary_email_address_id: "eml_1",
      }),
    );

    expect(outcome).toEqual({ type: "user.updated", action: "reconciled", matched: true });
    expect((await acct("clerk:w1"))?.displayName).toBe("Sofia Marino");
    expect((await acct("clerk:w1"))?.email).toBe("sofia.marino@example.com");
    expect((await person(personId))?.displayName).toBe("Sofia Marino");
  });

  it("does not overwrite a good name when the provider sends no first/last name", async () => {
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk:w2",
      provider: "clerk",
      emailVerified: true,
      email: "keep@example.com",
      displayName: "Keep Me",
    });

    await applyClerkWebhookEvent(
      db,
      userUpdated({
        id: "clerk:w2",
        first_name: null,
        last_name: null,
        email_addresses: [{ id: "eml_1", email_address: "still@example.com" }],
        primary_email_address_id: "eml_1",
      }),
    );

    // Name preserved (no fallback to email local-part / "Family member"); email still reconciled.
    expect((await person(personId))?.displayName).toBe("Keep Me");
    expect((await acct("clerk:w2"))?.email).toBe("still@example.com");
  });

  it("reports matched:false for an update on a never-provisioned user", async () => {
    const outcome = await applyClerkWebhookEvent(db, userUpdated({ id: "clerk:ghost" }));
    expect(outcome).toEqual({ type: "user.updated", action: "reconciled", matched: false });
  });
});

describe("applyClerkWebhookEvent — user.deleted", () => {
  it("soft-deletes the account and preserves the Person", async () => {
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "clerk:d1",
      provider: "clerk",
      emailVerified: true,
      email: "d@example.com",
      displayName: "Dana",
    });

    const outcome = await applyClerkWebhookEvent(db, {
      type: "user.deleted",
      data: { id: "clerk:d1", deleted: true },
    });

    expect(outcome).toEqual({ type: "user.deleted", action: "deactivated", matched: true });
    expect((await acct("clerk:d1"))?.active).toBe(false);
    expect((await person(personId))?.displayName).toBe("Dana");
  });

  it("ignores a deleted event with no id", async () => {
    const outcome = await applyClerkWebhookEvent(db, {
      type: "user.deleted",
      data: { deleted: true },
    });
    expect(outcome).toEqual({ type: "user.deleted", action: "ignored" });
  });
});

describe("applyClerkWebhookEvent — resolves via ATTACHED identity (heal-attached id)", () => {
  it("reconciles by an ATTACHED identity, not just the creation id", async () => {
    const { personId, accountId } = await createAccountWithPerson(db, {
      authProviderUserId: "dev_id9",
      provider: "clerk",
      emailVerified: true,
      email: "w9@x.com",
      displayName: "Old Name",
    });
    // A heal path attaches a NEW prod-instance id to the SAME account after creation.
    await attachIdentity(db, accountId, "clerk", "prod_id9");

    const outcome = await applyClerkWebhookEvent(
      db,
      userUpdated({
        id: "prod_id9",
        first_name: "New",
        last_name: "Name",
        email_addresses: [{ id: "eml_1", email_address: "w9@x.com" }],
        primary_email_address_id: "eml_1",
      }),
    );

    expect(outcome).toEqual({ type: "user.updated", action: "reconciled", matched: true });
    expect((await person(personId))?.displayName).toBe("New Name");
  });

  it("deactivates by an ATTACHED identity, not just the creation id", async () => {
    const { personId, accountId } = await createAccountWithPerson(db, {
      authProviderUserId: "dev_id10",
      provider: "clerk",
      emailVerified: true,
      email: "w10@x.com",
      displayName: "Dead Name",
    });
    await attachIdentity(db, accountId, "clerk", "prod_id10");

    const outcome = await applyClerkWebhookEvent(db, {
      type: "user.deleted",
      data: { id: "prod_id10", deleted: true },
    });

    expect(outcome).toEqual({ type: "user.deleted", action: "deactivated", matched: true });
    // The whole account is severed regardless of WHICH identity carried the delete.
    const [acctRow] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.authProviderUserId, "dev_id10"))
      .limit(1);
    expect(acctRow?.active).toBe(false);
    expect((await person(personId))?.displayName).toBe("Dead Name");
  });
});

describe("applyClerkWebhookEvent — other types", () => {
  it("ignores an unhandled event type (still a success for Clerk)", async () => {
    const outcome = await applyClerkWebhookEvent(db, {
      type: "session.created",
      data: { id: "sess_1" },
    });
    expect(outcome).toEqual({ type: "session.created", action: "ignored" });
  });
});
