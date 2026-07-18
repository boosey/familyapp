/**
 * Tests for surface-and-confirm pending invites (#120): an account's VERIFIED contacts surface
 * live pending invitations as confirm cards (family + inviter name only); unverified contacts,
 * dismissed invites, expired invites, and already-joined families never surface; "Not me" is a
 * per-account dismissal that never revokes the invite.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { invitations } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership,
  createAccountWithPerson,
  createInvitation,
  dismissInvitationForAccount,
  listPendingInvitationsForPerson,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** Steward + family (steward is an active member, so they may invite). */
async function familyWithSteward(name = "Esposito") {
  const steward = await makePerson(db, "Rosa Esposito");
  const fam = await makeFamily(db, name, steward.id);
  await addMembership(db, {
    personId: steward.id,
    familyId: fam.id,
    role: "steward",
  });
  return { steward, fam };
}

/** An account-backed person with a verified email and/or phone contact. */
async function accountPerson(
  displayName: string,
  contacts: { email?: string; phone?: string; verified?: boolean } = {},
) {
  const verified = contacts.verified !== false;
  return createAccountWithPerson(db, {
    provider: "clerk",
    authProviderUserId: `user_${Math.random()}`,
    email: contacts.email ?? `${Math.random()}@x.com`,
    emailVerified: contacts.email !== undefined ? verified : true,
    phone: contacts.phone,
    phoneVerified: contacts.phone !== undefined ? verified : false,
    displayName,
  });
}

describe("listPendingInvitationsForPerson (#120)", () => {
  it("surfaces a live invite addressed to the account's VERIFIED email — family + inviter, not invitee name", async () => {
    const { steward, fam } = await familyWithSteward();
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore Secret",
      inviteeEmail: "sal@example.com",
    });
    const { personId } = await accountPerson("Sal", { email: "sal@example.com" });

    const matches = await listPendingInvitationsForPerson(db, personId);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.familyName).toBe("Esposito");
    expect(matches[0]!.inviterName).toBe("Rosa Esposito");
    // The card NEVER echoes the inviter-typed invitee name back.
    expect(JSON.stringify(matches[0])).not.toContain("Salvatore Secret");
  });

  it("surfaces a live invite addressed to the account's VERIFIED phone", async () => {
    const { steward, fam } = await familyWithSteward();
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteePhone: "+12133734253",
    });
    const { personId } = await accountPerson("Sal", { phone: "+12133734253" });

    const matches = await listPendingInvitationsForPerson(db, personId);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.familyId).toBe(fam.id);
  });

  it("matches email case-insensitively", async () => {
    const { steward, fam } = await familyWithSteward();
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "SAL@EXAMPLE.COM",
    });
    const { personId } = await accountPerson("Sal", { email: "sal@example.com" });
    expect(await listPendingInvitationsForPerson(db, personId)).toHaveLength(1);
  });

  it("surfaces MULTIPLE simultaneous matches (invited to two families)", async () => {
    const a = await familyWithSteward("Esposito");
    const b = await familyWithSteward("Boudreaux");
    for (const { steward, fam } of [a, b]) {
      await createInvitation(db, {
        familyId: fam.id,
        inviterPersonId: steward.id,
        inviteeName: "Sal",
        inviteeEmail: "sal@example.com",
      });
    }
    const { personId } = await accountPerson("Sal", { email: "sal@example.com" });

    const matches = await listPendingInvitationsForPerson(db, personId);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.familyName).sort()).toEqual([
      "Boudreaux",
      "Esposito",
    ]);
  });

  it("never matches an UNVERIFIED contact", async () => {
    const { steward, fam } = await familyWithSteward();
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const { personId } = await accountPerson("Sal", {
      email: "sal@example.com",
      verified: false,
    });
    expect(await listPendingInvitationsForPerson(db, personId)).toHaveLength(0);
  });

  it("does not surface an EXPIRED invite", async () => {
    const { steward, fam } = await familyWithSteward();
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
      ttlMs: -1000, // already expired
    });
    const { personId } = await accountPerson("Sal", { email: "sal@example.com" });
    expect(await listPendingInvitationsForPerson(db, personId)).toHaveLength(0);
  });

  it("does not surface an invite to a family the person ALREADY belongs to", async () => {
    const { steward, fam } = await familyWithSteward();
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const { personId } = await accountPerson("Sal", { email: "sal@example.com" });
    // They joined through the link already — the leftover invite must not re-surface.
    await addMembership(db, { personId, familyId: fam.id });
    expect(await listPendingInvitationsForPerson(db, personId)).toHaveLength(0);
  });

  it("a person with no Account never has matches", async () => {
    const { steward, fam } = await familyWithSteward();
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const accountless = await makePerson(db, "Accountless");
    expect(await listPendingInvitationsForPerson(db, accountless.id)).toHaveLength(0);
  });
});

describe("dismissInvitationForAccount (#120)", () => {
  it("a dismissed invite stops surfacing — and the invitation itself is untouched", async () => {
    const { steward, fam } = await familyWithSteward();
    const { invitationId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const { accountId, personId } = await accountPerson("Sal", {
      email: "sal@example.com",
    });
    expect(await listPendingInvitationsForPerson(db, personId)).toHaveLength(1);

    await dismissInvitationForAccount(db, { invitationId, accountId });
    expect(await listPendingInvitationsForPerson(db, personId)).toHaveLength(0);

    // "Not me" NEVER revokes the invite — it stays pending for the real invitee's link.
    const [invite] = await db
      .select({ status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, invitationId));
    expect(invite?.status).toBe("pending");
  });

  it("is idempotent (double-tap 'Not me' is a no-op)", async () => {
    const { steward, fam } = await familyWithSteward();
    const { invitationId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const { accountId } = await accountPerson("Sal", { email: "sal@example.com" });
    await dismissInvitationForAccount(db, { invitationId, accountId });
    await expect(
      dismissInvitationForAccount(db, { invitationId, accountId }),
    ).resolves.toBeUndefined();
  });
});
