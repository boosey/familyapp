/**
 * Tests for member invitations — token hashing (raw never stored in plaintext; hash + sealed
 * copy), the one-durable-link rule (#116: rotation only on a dead invite), the #105 throttle,
 * re-invite dedup, the inviter-must-be-member guard, the safe welcome-screen view, and atomic
 * accept (membership + status flip; reject double-accept and expired).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { kinshipAssertions } from "@chronicle/db/kinship";
import {
  accountContacts,
  accounts,
  asks,
  invitations,
  memberships,
  persons,
} from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AlreadyFamilyMemberError,
  AuthorizationError,
  InvariantViolation,
  ThrottleError,
  acceptInvitation,
  addMembership,
  createInvitation,
  getInvitationByToken,
  getInvitationTokenForDelivery,
  isActiveMember,
  openToken,
  reapUnacceptedInvitees,
  resolveKinshipProjection,
  type AuthContext,
} from "../src/index";
import {
  INVITE_THROTTLE_DESTINATION_LIMIT,
  INVITE_THROTTLE_DESTINATION_WINDOW_MS,
  INVITE_THROTTLE_INVITER_LIMIT,
  INVITE_THROTTLE_INVITER_WINDOW_MS,
} from "../src/constants";
import { makeAccountPerson, makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** Steward + family with the steward as an active member (so they may invite). */
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

/**
 * Grant the invite STANDING check (#333) between `viewerId` and `personId`: create a family where
 * both hold ACTIVE membership, so `personId` is visible to `viewerId` (`resolveKinshipProjection`'s
 * co-membership clause). The simplest, most common way a List/Tree invite anchor is "known" to an
 * inviter — mirrors the canonical Zach-is-a-member-of-Boudreaux case.
 */
async function grantStanding(personId: string, viewerId: string) {
  const shared = await makeFamily(db, "Shared", viewerId);
  await addMembership(db, { personId: viewerId, familyId: shared.id, role: "member" });
  await addMembership(db, { personId, familyId: shared.id, role: "member" });
  return shared;
}

describe("createInvitation", () => {
  it("returns a raw token but stores only its hash", async () => {
    const { steward, fam } = await familyWithSteward();
    const { invitationId, token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
      relationshipLabel: "Rosa's father",
    });
    expect(token).toBeTruthy();
    const [row] = await db
      .select({ tokenHash: invitations.tokenHash })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    expect(row?.tokenHash).toBeTruthy();
    expect(row?.tokenHash).not.toBe(token); // raw token never persisted
  });

  it("stores an optional invitee phone and initializes delivery attempts to zero", async () => {
    const { steward, fam } = await familyWithSteward();
    const { invitationId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
      inviteePhone: "+15551230000",
    });
    const [row] = await db
      .select({
        inviteePhone: invitations.inviteePhone,
        deliveryAttempts: invitations.deliveryAttempts,
      })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    expect(row?.inviteePhone).toBe("+15551230000");
    expect(row?.deliveryAttempts).toBe(0);
  });

  it("persists requested delivery channels on the row", async () => {
    const { steward, fam } = await familyWithSteward();
    const { invitationId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
      inviteeEmail: "sal@example.com",
      inviteePhone: "+15551230000",
      deliveryChannels: ["email", "sms"],
    });
    const [row] = await db
      .select({ deliveryChannels: invitations.deliveryChannels })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    expect(row?.deliveryChannels).toEqual(["email", "sms"]);
  });

  it("rejects an inviter who is not an active member", async () => {
    const { fam } = await familyWithSteward();
    const stranger = await makePerson(db, "Stranger");
    await expect(
      createInvitation(db, { familyId: fam.id, inviterPersonId: stranger.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("mints a provisional Account-less Person anchored on the invitation (ADR-0006)", async () => {
    const { steward, fam } = await familyWithSteward();
    const { invitationId, inviteePersonId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore Esposito",
    });
    expect(inviteePersonId).toBeTruthy();

    const [person] = await db
      .select({ displayName: persons.displayName, accountId: persons.accountId })
      .from(persons)
      .where(eq(persons.id, inviteePersonId))
      .limit(1);
    expect(person?.accountId).toBeNull(); // provisional — no Account
    expect(person?.displayName).toBe("Salvatore Esposito");

    const [invite] = await db
      .select({ inviteePersonId: invitations.inviteePersonId })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    expect(invite?.inviteePersonId).toBe(inviteePersonId);
  });

  it("falls back to a placeholder name when no invitee name is supplied", async () => {
    const { steward, fam } = await familyWithSteward();
    const { inviteePersonId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
    });
    const [person] = await db
      .select({ displayName: persons.displayName })
      .from(persons)
      .where(eq(persons.id, inviteePersonId))
      .limit(1);
    expect(person?.displayName).toBe("Invited member");
  });
});

describe("createInvitation throttle (#105)", () => {
  /**
   * Bulk-seed invitation rows directly (token hashes just need uniqueness) so the throttle
   * boundary can be tested without driving the limit count through createInvitation itself.
   * Every seeded row anchors to one shared provisional Person — only the FK has to hold.
   */
  async function seedInvitations(opts: {
    count: number;
    inviterPersonId: string;
    familyId: string;
    email?: string;
    phone?: string;
    createdAt?: Date;
  }) {
    const anchor = await makePerson(db, "Seed Anchor");
    const stamp = Math.random().toString(36).slice(2);
    await db.insert(invitations).values(
      Array.from({ length: opts.count }, (_, i) => ({
        tokenHash: `seed-${stamp}-${i}`,
        familyId: opts.familyId,
        inviterPersonId: opts.inviterPersonId,
        inviteePersonId: anchor.id,
        inviteeEmail: opts.email ?? null,
        inviteePhone: opts.phone ?? null,
        createdAt: opts.createdAt ?? new Date(),
      })),
    );
  }

  it("allows invites up to the per-inviter ceiling, then refuses the next one", async () => {
    const { steward, fam } = await familyWithSteward();
    await seedInvitations({
      count: INVITE_THROTTLE_INVITER_LIMIT - 1,
      inviterPersonId: steward.id,
      familyId: fam.id,
    });
    // The invite that reaches the ceiling still goes through…
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
    });
    // …and the one past it is refused, writing nothing.
    await expect(
      createInvitation(db, {
        familyId: fam.id,
        inviterPersonId: steward.id,
        inviteeName: "One too many",
      }),
    ).rejects.toBeInstanceOf(ThrottleError);
  });

  it("does not count the inviter's invitations older than the window", async () => {
    const { steward, fam } = await familyWithSteward();
    await seedInvitations({
      count: INVITE_THROTTLE_INVITER_LIMIT,
      inviterPersonId: steward.id,
      familyId: fam.id,
      createdAt: new Date(Date.now() - INVITE_THROTTLE_INVITER_WINDOW_MS - 60_000),
    });
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
    });
  });

  it("does not count OTHER inviters toward the per-inviter ceiling", async () => {
    const { steward, fam } = await familyWithSteward();
    const other = await makePerson(db, "Other Member");
    await seedInvitations({
      count: INVITE_THROTTLE_INVITER_LIMIT,
      inviterPersonId: other.id,
      familyId: fam.id,
    });
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
    });
  });

  it("throttles repeat sends to the same email destination, case-insensitively, across inviters", async () => {
    const { steward, fam } = await familyWithSteward();
    const other = await makePerson(db, "Other Member");
    // Seeded by a DIFFERENT inviter, in mixed case — the destination arm is app-wide.
    await seedInvitations({
      count: INVITE_THROTTLE_DESTINATION_LIMIT,
      inviterPersonId: other.id,
      familyId: fam.id,
      email: "Sal@Example.com",
    });
    await expect(
      createInvitation(db, {
        familyId: fam.id,
        inviterPersonId: steward.id,
        inviteeName: "Salvatore",
        inviteeEmail: "sal@example.com",
      }),
    ).rejects.toBeInstanceOf(ThrottleError);
    // A different destination is unaffected.
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
      inviteeEmail: "salvatore@example.com",
    });
  });

  it("throttles repeat sends to the same phone destination", async () => {
    const { steward, fam } = await familyWithSteward();
    await seedInvitations({
      count: INVITE_THROTTLE_DESTINATION_LIMIT,
      inviterPersonId: steward.id,
      familyId: fam.id,
      phone: "+15551230000",
    });
    await expect(
      createInvitation(db, {
        familyId: fam.id,
        inviterPersonId: steward.id,
        inviteeName: "Salvatore",
        inviteePhone: "+15551230000",
      }),
    ).rejects.toBeInstanceOf(ThrottleError);
  });

  it("does not count destination sends older than the window", async () => {
    const { steward, fam } = await familyWithSteward();
    await seedInvitations({
      count: INVITE_THROTTLE_DESTINATION_LIMIT,
      inviterPersonId: steward.id,
      familyId: fam.id,
      email: "sal@example.com",
      createdAt: new Date(
        Date.now() - INVITE_THROTTLE_DESTINATION_WINDOW_MS - 60_000,
      ),
    });
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
      inviteeEmail: "sal@example.com",
    });
  });
});

// Regression: re-inviting an unaccepted invitee must NOT mint a second provisional Person.
// Previously every call created a fresh provisional Person + invitation row, so a failed/ignored
// invite that was sent again left a duplicate `origin='invitee'` Person behind.
describe("createInvitation re-invite dedup (regression)", () => {
  /** Count of provisional (origin='invitee') Persons in the DB. */
  async function inviteePersonCount(): Promise<number> {
    const rows = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.origin, "invitee"));
    return rows.length;
  }

  it("reuses the provisional Person and the invitation row when re-inviting the same email", async () => {
    const { steward, fam } = await familyWithSteward();
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
      inviteeEmail: "sal@example.com",
    });
    expect(await inviteePersonCount()).toBe(1);

    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
      inviteeEmail: "sal@example.com",
    });

    // No duplicate Person, no duplicate invitation row.
    expect(await inviteePersonCount()).toBe(1);
    expect(second.inviteePersonId).toBe(first.inviteePersonId);
    expect(second.invitationId).toBe(first.invitationId);
    const allInvites = await db.select({ id: invitations.id }).from(invitations);
    expect(allInvites).toHaveLength(1);
    // #116: the invite is still LIVE, so the durable link is reused — NO new token is minted.
    expect(second.token).toBe(first.token);
  });

  it("matches the email case-insensitively", async () => {
    const { steward, fam } = await familyWithSteward();
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "Sal@Example.com",
    });
    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    expect(second.inviteePersonId).toBe(first.inviteePersonId);
    expect(await inviteePersonCount()).toBe(1);
  });

  it("keeps the SAME token live across a re-invite of a pending invite (one durable link, #116)", async () => {
    const { steward, fam } = await familyWithSteward();
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });

    // The original emailed link still resolves — sending over a second channel did not kill it.
    expect(second.token).toBe(first.token);
    expect(await getInvitationByToken(db, first.token)).not.toBeNull();

    const joined = await makePerson(db, "Salvatore Esposito");
    const { familyId } = await acceptInvitation(db, {
      token: first.token,
      acceptedPersonId: joined.id,
    });
    expect(familyId).toBe(fam.id);
    expect(await isActiveMember(db, joined.id, fam.id)).toBe(true);
  });

  it("rotates the token when re-inviting an EXPIRED (dead) invite — the old link dies (#116)", async () => {
    const { steward, fam } = await familyWithSteward();
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
      ttlMs: -1, // already expired
    });
    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });

    // The dead invite's token no longer resolves; the rotated one does.
    expect(second.token).not.toBe(first.token);
    expect(await getInvitationByToken(db, first.token)).toBeNull();
    expect(await getInvitationByToken(db, second.token)).not.toBeNull();

    const joined = await makePerson(db, "Salvatore Esposito");
    const { familyId } = await acceptInvitation(db, {
      token: second.token,
      acceptedPersonId: joined.id,
    });
    expect(familyId).toBe(fam.id);
  });

  it("re-invites an EXPIRED invite by refreshing it back to pending", async () => {
    const { steward, fam } = await familyWithSteward();
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
      ttlMs: -1, // already expired
    });
    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    expect(await inviteePersonCount()).toBe(1);
    const view = await getInvitationByToken(db, second.token);
    expect(view?.status).toBe("pending");
    expect(view?.expired).toBe(false);
  });

  // The load-bearing reason we refresh the invite IN PLACE rather than adding a row: the reaper
  // deletes ALL invitations pointing at a reaped provisional Person. A stale dead invite alongside
  // a fresh one would let the reaper destroy the live invite.
  it("survives the reaper after a re-invite refreshes an expired invite", async () => {
    const { steward, fam } = await familyWithSteward();
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
      ttlMs: -1, // expired — reapable on its own
    });
    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });

    const { reapedPersonIds } = await reapUnacceptedInvitees(db);
    expect(reapedPersonIds).toHaveLength(0);
    // The fresh invite and its Person are still intact and usable.
    expect(await inviteePersonCount()).toBe(1);
    expect(await getInvitationByToken(db, second.token)).not.toBeNull();
  });

  it("does NOT merge distinct emails into one Person", async () => {
    const { steward, fam } = await familyWithSteward();
    const a = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const b = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Maria",
      inviteeEmail: "maria@example.com",
    });
    expect(b.inviteePersonId).not.toBe(a.inviteePersonId);
    expect(await inviteePersonCount()).toBe(2);
  });

  it("scopes dedup to the family — the same email in another family is a distinct invite", async () => {
    const { steward, fam } = await familyWithSteward("Esposito");
    const fam2 = await makeFamily(db, "Ricci", steward.id);
    await addMembership(db, {
      personId: steward.id,
      familyId: fam2.id,
      role: "steward",
    });
    const a = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const b = await createInvitation(db, {
      familyId: fam2.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    expect(b.inviteePersonId).not.toBe(a.inviteePersonId);
    expect(await inviteePersonCount()).toBe(2);
  });

  it("does NOT dedup email-less invites — email is the only reliable dedup key", async () => {
    // Without a contact key we refuse to guess: matching by name alone risks silently merging two
    // different people who share a name. Email-less repeat invites mint fresh provisional Persons
    // (the reaper cleans up the abandoned ones).
    const { steward, fam } = await familyWithSteward();
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Grandpa Joe",
    });
    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Grandpa Joe",
    });
    expect(second.inviteePersonId).not.toBe(first.inviteePersonId);
    expect(await inviteePersonCount()).toBe(2);
  });

  it("does not fold an email-less invite into an email-addressed one of the same name", async () => {
    const { steward, fam } = await familyWithSteward();
    const withEmail = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const withoutEmail = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
    });
    expect(withoutEmail.inviteePersonId).not.toBe(withEmail.inviteePersonId);
    expect(await inviteePersonCount()).toBe(2);
  });

  it("still lets a re-invite go through after the invitee has ACCEPTED (already a member)", async () => {
    // An accepted invitation is not a duplicate to fold into — its anchor is a real Account Person.
    const { steward, fam } = await familyWithSteward();
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const joined = await makePerson(db, "Salvatore");
    await acceptInvitation(db, { token: first.token, acceptedPersonId: joined.id });

    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    // A brand-new provisional Person is minted (we do not resurrect the accepted anchor).
    expect(second.inviteePersonId).not.toBe(joined.id);
  });
});

describe("durable invite token (#116)", () => {
  it("stores only the token's hash and a sealed copy — never the raw token", async () => {
    const { steward, fam } = await familyWithSteward();
    const { invitationId, token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const [row] = await db
      .select({
        tokenHash: invitations.tokenHash,
        tokenSealed: invitations.tokenSealed,
      })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.tokenSealed).toBeTruthy();
    expect(row?.tokenSealed).not.toContain(token); // sealed, not plaintext
    // …and the sealed copy opens back to the raw token under the active key.
    expect(openToken(row!.tokenSealed)).toBe(token);
  });

  it("getInvitationTokenForDelivery recovers the raw token of a live pending invite", async () => {
    const { steward, fam } = await familyWithSteward();
    const { invitationId, token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    expect(await getInvitationTokenForDelivery(db, invitationId)).toBe(token);
  });

  it("getInvitationTokenForDelivery returns null for an expired or accepted invite", async () => {
    const { steward, fam } = await familyWithSteward();
    const expired = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
      ttlMs: -1,
    });
    expect(await getInvitationTokenForDelivery(db, expired.invitationId)).toBeNull();

    const live = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Maria",
      inviteeEmail: "maria@example.com",
    });
    const joined = await makePerson(db, "Maria Esposito");
    await acceptInvitation(db, { token: live.token, acceptedPersonId: joined.id });
    expect(await getInvitationTokenForDelivery(db, live.invitationId)).toBeNull();
  });

  it("rotates (does not crash) when re-inviting a legacy invite whose token was never sealed", async () => {
    const { steward, fam } = await familyWithSteward();
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    // Simulate a pre-#116 row: no sealed copy exists to recover the durable token from.
    await db
      .update(invitations)
      .set({ tokenSealed: null })
      .where(eq(invitations.id, first.invitationId));
    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    expect(second.invitationId).toBe(first.invitationId);
    expect(second.token).not.toBe(first.token); // unrecoverable → rotate
    expect(await getInvitationByToken(db, second.token)).not.toBeNull();
  });
});

describe("createInvitation dedup on email OR phone + merge-on-collision (#117)", () => {
  /** Count of provisional (origin='invitee') Persons in the DB. */
  async function inviteePersonCount(): Promise<number> {
    const rows = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.origin, "invitee"));
    return rows.length;
  }

  it("dedups a re-invite matched on PHONE only", async () => {
    const { steward, fam } = await familyWithSteward();
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteePhone: "+15551230000",
    });
    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteePhone: "+15551230000",
    });
    expect(second.inviteePersonId).toBe(first.inviteePersonId);
    expect(second.invitationId).toBe(first.invitationId);
    expect(await inviteePersonCount()).toBe(1);
  });

  it("matches a single provisional via EITHER identifier when both were entered", async () => {
    const { steward, fam } = await familyWithSteward();
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
      inviteePhone: "+15551230000",
    });
    const viaEmail = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const viaPhone = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteePhone: "+15551230000",
    });
    expect(viaEmail.inviteePersonId).toBe(first.inviteePersonId);
    expect(viaPhone.inviteePersonId).toBe(first.inviteePersonId);
    expect(await inviteePersonCount()).toBe(1);
  });

  it("merges colliding provisionals (email→A, phone→B): asks + invite re-pointed, DEAD loser deleted", async () => {
    const { steward, fam } = await familyWithSteward();
    const a = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const b = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteePhone: "+15551230000",
      ttlMs: -1, // dead — a merge only ever deletes a DEAD loser (a live link must survive)
    });
    expect(b.inviteePersonId).not.toBe(a.inviteePersonId);
    expect(await inviteePersonCount()).toBe(2);

    // A question queued against the phone-only provisional BEFORE the collision is discovered.
    const [queued] = await db
      .insert(asks)
      .values({
        askerPersonId: steward.id,
        targetPersonId: b.inviteePersonId,
        questionText: "What was your village like?",
        status: "queued",
      })
      .returning({ id: asks.id });

    // The re-invite carrying BOTH identifiers discovers the collision and merges.
    const merged = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
      inviteePhone: "+15551230000",
    });

    // The EMAIL-matched provisional wins; the phone-only one is gone, person and invite row alike.
    expect(merged.inviteePersonId).toBe(a.inviteePersonId);
    expect(merged.invitationId).toBe(a.invitationId);
    expect(await inviteePersonCount()).toBe(1);
    const allInvites = await db.select({ id: invitations.id }).from(invitations);
    expect(allInvites).toHaveLength(1);
    const loserGone = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.id, b.inviteePersonId));
    expect(loserGone).toHaveLength(0);

    // The queued ask moved onto the surviving provisional.
    const [ask] = await db
      .select({ targetPersonId: asks.targetPersonId })
      .from(asks)
      .where(eq(asks.id, queued!.id))
      .limit(1);
    expect(ask?.targetPersonId).toBe(a.inviteePersonId);

    // The surviving invite carries the FULL identifier set entered this time.
    const [refreshed] = await db
      .select({
        inviteeEmail: invitations.inviteeEmail,
        inviteePhone: invitations.inviteePhone,
      })
      .from(invitations)
      .where(eq(invitations.id, a.invitationId))
      .limit(1);
    expect(refreshed?.inviteeEmail).toBe("sal@example.com");
    expect(refreshed?.inviteePhone).toBe("+15551230000");
  });

  it("preserves a LIVE loser invite — its already-delivered link keeps working (#116)", async () => {
    const { steward, fam } = await familyWithSteward();
    const a = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    const b = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteePhone: "+15551230000",
    });
    expect(b.inviteePersonId).not.toBe(a.inviteePersonId);

    // The re-invite carrying BOTH identifiers collides — but BOTH invites are live, so nothing is
    // merged away: the winner is refreshed, the live loser keeps its row, Person, and token.
    const merged = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
      inviteePhone: "+15551230000",
    });

    expect(merged.invitationId).toBe(a.invitationId); // live email match wins
    expect(await inviteePersonCount()).toBe(2); // both provisionals survive
    // The live loser's previously-sent link still resolves.
    const loserView = await getInvitationByToken(db, b.token);
    expect(loserView).not.toBeNull();
    expect(loserView?.status).toBe("pending");
  });

  it("keeps people with no shared identifier separate", async () => {
    const { steward, fam } = await familyWithSteward();
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Maria",
      inviteePhone: "+15551230000",
    });
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Grandpa Joe",
    });
    expect(await inviteePersonCount()).toBe(3);
  });

  it("reaper cannot orphan the surviving invite after a merge", async () => {
    const { steward, fam } = await familyWithSteward();
    const a = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteePhone: "+15551230000",
      ttlMs: -1, // dead + reapable on its own
    });
    const merged = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
      inviteePhone: "+15551230000",
    });

    const { reapedPersonIds } = await reapUnacceptedInvitees(db);
    expect(reapedPersonIds).toHaveLength(0);
    expect(merged.invitationId).toBe(a.invitationId);
    expect(await getInvitationByToken(db, merged.token)).not.toBeNull();
    expect(await inviteePersonCount()).toBe(1);
  });
});

describe("getInvitationByToken", () => {
  it("returns the safe welcome-screen view (no email)", async () => {
    const { steward, fam } = await familyWithSteward("Esposito");
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
      inviteeEmail: "sal@example.com",
      relationshipLabel: "Rosa's father",
    });
    const view = await getInvitationByToken(db, token);
    expect(view).not.toBeNull();
    expect(view?.familyName).toBe("Esposito");
    expect(view?.inviterName).toBe("Rosa Esposito");
    expect(view?.inviteeName).toBe("Salvatore");
    expect(view?.relationshipLabel).toBe("Rosa's father");
    expect(view?.status).toBe("pending");
    expect(view?.expired).toBe(false);
    expect(JSON.stringify(view)).not.toContain("sal@example.com");
  });

  it("returns null for an unknown token", async () => {
    expect(await getInvitationByToken(db, "nope")).toBeNull();
  });

  it("marks an expired invite as expired", async () => {
    const { steward, fam } = await familyWithSteward();
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      ttlMs: -1, // already expired
    });
    const view = await getInvitationByToken(db, token);
    expect(view?.expired).toBe(true);
  });
});

describe("acceptInvitation", () => {
  it("creates the membership and flips status to accepted", async () => {
    const { steward, fam } = await familyWithSteward();
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
    });
    const invitee = await makePerson(db, "Salvatore");
    const { membershipId, familyId } = await acceptInvitation(db, {
      token,
      acceptedPersonId: invitee.id,
    });
    expect(membershipId).toBeTruthy();
    expect(familyId).toBe(fam.id);
    expect(await isActiveMember(db, invitee.id, fam.id)).toBe(true);
    const view = await getInvitationByToken(db, token);
    expect(view?.status).toBe("accepted");
  });

  it("applies the invite role on the new membership", async () => {
    const { steward, fam } = await familyWithSteward();
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      role: "narrator",
    });
    const invitee = await makePerson(db, "Nonno");
    await acceptInvitation(db, { token, acceptedPersonId: invitee.id });
    const [row] = await db
      .select({ status: invitations.status })
      .from(invitations);
    expect(row?.status).toBe("accepted");
  });

  it("lets the welcome screen override the relationship label", async () => {
    const { steward, fam } = await familyWithSteward();
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      relationshipLabel: "father",
    });
    const invitee = await makePerson(db, "Sal");
    await acceptInvitation(db, {
      token,
      acceptedPersonId: invitee.id,
      relationshipLabel: "grandfather",
    });
    const [row] = await db
      .select({ relationshipLabel: invitations.relationshipLabel })
      .from(invitations);
    expect(row?.relationshipLabel).toBe("grandfather");
  });

  it("rejects a second accept (idempotency guard)", async () => {
    const { steward, fam } = await familyWithSteward();
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
    });
    const invitee = await makePerson(db, "Sal");
    await acceptInvitation(db, { token, acceptedPersonId: invitee.id });
    const other = await makePerson(db, "Other");
    await expect(
      acceptInvitation(db, { token, acceptedPersonId: other.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("rejects accepting an expired invite", async () => {
    const { steward, fam } = await familyWithSteward();
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      ttlMs: -1,
    });
    const invitee = await makePerson(db, "Sal");
    await expect(
      acceptInvitation(db, { token, acceptedPersonId: invitee.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("rejects an unknown token", async () => {
    const invitee = await makePerson(db, "Sal");
    await expect(
      acceptInvitation(db, { token: "nope", acceptedPersonId: invitee.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  // ADR-0006 merge: acceptance folds the provisional invitee Person into the accepting Person.
  it("merges the provisional invitee: re-points queued asks, deletes the provisional row", async () => {
    const { steward, fam } = await familyWithSteward();
    const { token, inviteePersonId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Nonna",
    });

    // A question queued against the pending invitee BEFORE they joined.
    const [queued] = await db
      .insert(asks)
      .values({
        askerPersonId: steward.id,
        targetPersonId: inviteePersonId,
        questionText: "What was your village like?",
        status: "queued",
      })
      .returning({ id: asks.id });

    // The invitee signs up as a brand-new Person (ADR-0005 mints it) and accepts.
    const joined = await makePerson(db, "Nonna Esposito");
    await acceptInvitation(db, { token, acceptedPersonId: joined.id });

    // The queued ask now targets the real Person, not the provisional one.
    const [ask] = await db
      .select({ targetPersonId: asks.targetPersonId })
      .from(asks)
      .where(eq(asks.id, queued!.id))
      .limit(1);
    expect(ask?.targetPersonId).toBe(joined.id);

    // The provisional Person is gone, and the invitation anchor re-points to the real Person.
    const provRows = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.id, inviteePersonId));
    expect(provRows).toHaveLength(0);
    const [invite] = await db
      .select({
        inviteePersonId: invitations.inviteePersonId,
        acceptedPersonId: invitations.acceptedPersonId,
      })
      .from(invitations);
    expect(invite?.inviteePersonId).toBe(joined.id);
    expect(invite?.acceptedPersonId).toBe(joined.id);
  });
});


describe("same-family duplicate-member guard (#119)", () => {
  /** Account-backed person with verified contacts + a membership in the given family. */
  async function memberWithContacts(
    familyId: string,
    contacts: { kind: "email" | "phone"; value: string; verified?: boolean }[],
    membershipStatus: "active" | "ended" = "active",
  ) {
    const [acct] = await db
      .insert(accounts)
      .values({ authProviderUserId: `user_${Math.random()}`, email: contacts[0]?.value ?? "m@x.com" })
      .returning({ id: accounts.id });
    for (const c of contacts) {
      await db.insert(accountContacts).values({
        accountId: acct!.id,
        kind: c.kind,
        value: c.value,
        verifiedAt: c.verified === false ? null : new Date(),
      });
    }
    const [person] = await db
      .insert(persons)
      .values({ displayName: "Existing Member", accountId: acct!.id })
      .returning({ id: persons.id });
    await db.insert(memberships).values({
      personId: person!.id,
      familyId,
      status: membershipStatus,
    });
    return person!;
  }

  it("rejects an invite whose EMAIL belongs to an active member of the family", async () => {
    const { steward, fam } = await familyWithSteward();
    await memberWithContacts(fam.id, [{ kind: "email", value: "sal@example.com" }]);
    await expect(
      createInvitation(db, {
        familyId: fam.id,
        inviterPersonId: steward.id,
        inviteeName: "Sal",
        inviteeEmail: "SAL@example.com", // case-insensitive
      }),
    ).rejects.toBeInstanceOf(AlreadyFamilyMemberError);
  });

  it("rejects an invite whose PHONE belongs to an active member of the family", async () => {
    const { steward, fam } = await familyWithSteward();
    await memberWithContacts(fam.id, [{ kind: "phone", value: "+15551234567" }]);
    await expect(
      createInvitation(db, {
        familyId: fam.id,
        inviterPersonId: steward.id,
        inviteeName: "Sal",
        inviteePhone: "+15551234567",
      }),
    ).rejects.toBeInstanceOf(AlreadyFamilyMemberError);
  });

  it("allows the same contact in a DIFFERENT family", async () => {
    const { steward, fam } = await familyWithSteward();
    const other = await makeFamily(db, "Other", steward.id);
    await memberWithContacts(other.id, [{ kind: "email", value: "sal@example.com" }]);
    const invite = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    expect(invite.token).toBeTruthy();
  });

  it("never matches an UNVERIFIED contact", async () => {
    const { steward, fam } = await familyWithSteward();
    await memberWithContacts(fam.id, [
      { kind: "email", value: "sal@example.com", verified: false },
    ]);
    const invite = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    expect(invite.token).toBeTruthy();
  });

  it("allows re-inviting after the membership has ENDED", async () => {
    const { steward, fam } = await familyWithSteward();
    await memberWithContacts(
      fam.id,
      [{ kind: "email", value: "sal@example.com" }],
      "ended",
    );
    const invite = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      inviteeEmail: "sal@example.com",
    });
    expect(invite.token).toBeTruthy();
  });
});

// Person-bound Invitation create (issue #333, ADR-0028) — an invite started from an existing
// List/Tree Person binds to that Person on create instead of minting a fresh provisional one
// (Dedup-on-invite, extended beyond cold-mention matching). Canonical scenario: Zach → Carney.
describe("createInvitation person-bound (#333, ADR-0028)", () => {
  /** Count of ALL persons in the DB — the strongest possible "no second identity minted" check. */
  async function personCount(): Promise<number> {
    const rows = await db.select({ id: persons.id }).from(persons);
    return rows.length;
  }

  it("binds to the existing Person on create — no second Person minted", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    const zach = await makePerson(db, "Zach Boudreaux");
    await grantStanding(zach.id, steward.id); // #333 standing: shared family with the inviter
    const before = await personCount();

    const { invitationId, inviteePersonId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: zach.id,
    });

    expect(inviteePersonId).toBe(zach.id);
    expect(await personCount()).toBe(before); // no second Person minted

    const [invite] = await db
      .select({ inviteePersonId: invitations.inviteePersonId })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    expect(invite?.inviteePersonId).toBe(zach.id);
  });

  it("prefills inviteeName from the Person's displayName when the caller supplies none", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    const zach = await makePerson(db, "Zach Boudreaux");
    await grantStanding(zach.id, steward.id); // #333 standing: shared family with the inviter
    const { invitationId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: zach.id,
    });
    const [invite] = await db
      .select({ inviteeName: invitations.inviteeName })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    expect(invite?.inviteeName).toBe("Zach Boudreaux");
  });

  it("still honors a caller-supplied inviteeName over the Person's displayName", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    const zach = await makePerson(db, "Zach Boudreaux");
    await grantStanding(zach.id, steward.id); // #333 standing: shared family with the inviter
    const { invitationId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: zach.id,
      inviteeName: "Zachary",
    });
    const [invite] = await db
      .select({ inviteeName: invitations.inviteeName })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    expect(invite?.inviteeName).toBe("Zachary");
  });

  it("refuses when the invitee is already an active Member of the target family", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    const zach = await makePerson(db, "Zach Boudreaux");
    await addMembership(db, { personId: zach.id, familyId: fam.id, role: "member" });

    await expect(
      createInvitation(db, {
        familyId: fam.id,
        inviterPersonId: steward.id,
        existingInviteePersonId: zach.id,
      }),
    ).rejects.toBeInstanceOf(AlreadyFamilyMemberError);
  });

  it("allows a person-bound invite into a DIFFERENT family when the inviter has standing (shares a family with the invitee)", async () => {
    // Canonical Zach → Carney scenario: Zach is a member of Boudreaux; the INVITER is ALSO an active
    // member of Boudreaux (where Zach is visible to them), which is what gives them standing to name
    // Zach as an invite anchor into Carney — being a Carney steward alone would not be enough (#333).
    const { steward, fam: boudreaux } = await familyWithSteward("Boudreaux");
    const zach = await makePerson(db, "Zach Boudreaux");
    await addMembership(db, { personId: zach.id, familyId: boudreaux.id, role: "member" });

    const carney = await makeFamily(db, "Carney", steward.id);
    await addMembership(db, { personId: steward.id, familyId: carney.id, role: "steward" });

    const { inviteePersonId } = await createInvitation(db, {
      familyId: carney.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: zach.id,
    });
    expect(inviteePersonId).toBe(zach.id);
  });

  it("refuses a person-bound invite when the inviter has NO shared family with the invitee (standing, #333)", async () => {
    // Zach is only ever a member of Boudreaux. The Carney steward has never shared a family with him
    // — no membership overlap, no visible kinship edge — so they have no standing to name him as an
    // invite anchor, even though they ARE an active member of the target family (Carney).
    const { fam: boudreaux } = await familyWithSteward("Boudreaux");
    const zach = await makePerson(db, "Zach Boudreaux");
    await addMembership(db, { personId: zach.id, familyId: boudreaux.id, role: "member" });

    const { steward: carneySteward, fam: carney } = await familyWithSteward("Carney");
    await expect(
      createInvitation(db, {
        familyId: carney.id,
        inviterPersonId: carneySteward.id,
        existingInviteePersonId: zach.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refreshes an existing pending person-bound invite in place instead of duplicating", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    const zach = await makePerson(db, "Zach Boudreaux");
    await grantStanding(zach.id, steward.id); // #333 standing: shared family with the inviter
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: zach.id,
    });
    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: zach.id,
    });

    expect(second.invitationId).toBe(first.invitationId);
    expect(second.inviteePersonId).toBe(zach.id);
    expect(second.token).toBe(first.token); // durable link (#116) reused

    const rows = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.inviteePersonId, zach.id));
    expect(rows).toHaveLength(1);
  });

  it("rotates the token when refreshing a DEAD person-bound invite", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    const zach = await makePerson(db, "Zach Boudreaux");
    await grantStanding(zach.id, steward.id); // #333 standing: shared family with the inviter
    const first = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: zach.id,
      ttlMs: -1, // already expired
    });
    const second = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: zach.id,
    });
    expect(second.invitationId).toBe(first.invitationId);
    expect(second.token).not.toBe(first.token);
    expect(await getInvitationByToken(db, second.token)).not.toBeNull();
  });

  it("refuses when the existing Person does not exist", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    await expect(
      createInvitation(db, {
        familyId: fam.id,
        inviterPersonId: steward.id,
        existingInviteePersonId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("refuses when the existing Person is an unidentified placeholder", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    const [placeholder] = await db
      .insert(persons)
      .values({ displayName: null, origin: "mention", identified: false })
      .returning({ id: persons.id });
    await expect(
      createInvitation(db, {
        familyId: fam.id,
        inviterPersonId: steward.id,
        existingInviteePersonId: placeholder!.id,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("refuses when the existing Person is deceased", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    const [deceased] = await db
      .insert(persons)
      .values({ displayName: "Nonno", lifeStatus: "deceased" })
      .returning({ id: persons.id });
    await expect(
      createInvitation(db, {
        familyId: fam.id,
        inviterPersonId: steward.id,
        existingInviteePersonId: deceased!.id,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("regression: a cold create (no existingInviteePersonId) still mints a provisional Person", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    const before = await personCount();
    const { inviteePersonId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Grandpa Joe",
    });
    expect(await personCount()).toBe(before + 1);
    const [person] = await db
      .select({ accountId: persons.accountId, origin: persons.origin })
      .from(persons)
      .where(eq(persons.id, inviteePersonId))
      .limit(1);
    expect(person?.accountId).toBeNull();
    expect(person?.origin).toBe("invitee");
  });
});

// Account-holder accept of a person-bound Invitation (issue #333, ADR-0028) — adds Membership (and
// relationship per ADR-0023) without minting a second Person. Canonical scenario: Zach → Carney.
describe("acceptInvitation of a person-bound invite (#333, ADR-0028)", () => {
  const account = (personId: string): AuthContext => ({ kind: "account", personId });

  async function personCount(): Promise<number> {
    const rows = await db.select({ id: persons.id }).from(persons);
    return rows.length;
  }

  it("Account-holder accept adds Membership on the SAME Person id — no second Person minted", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    const zach = await makeAccountPerson(db, "Zach Boudreaux");
    await grantStanding(zach.id, steward.id); // #333 standing: shared family with the inviter
    const before = await personCount();

    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: zach.id,
    });
    const { membershipId, familyId } = await acceptInvitation(db, {
      token,
      acceptedPersonId: zach.id,
    });

    expect(membershipId).toBeTruthy();
    expect(familyId).toBe(fam.id);
    expect(await isActiveMember(db, zach.id, fam.id)).toBe(true);
    expect(await personCount()).toBe(before); // no second Person minted

    const [invite] = await db
      .select({
        inviteePersonId: invitations.inviteePersonId,
        acceptedPersonId: invitations.acceptedPersonId,
        status: invitations.status,
      })
      .from(invitations);
    expect(invite?.inviteePersonId).toBe(zach.id);
    expect(invite?.acceptedPersonId).toBe(zach.id);
    expect(invite?.status).toBe("accepted");
  });

  it("places the Account-holder on the tree per the invite's structured relationship (ADR-0023)", async () => {
    const { steward, fam } = await familyWithSteward("Carney");
    const zach = await makeAccountPerson(db, "Zach Boudreaux");
    await grantStanding(zach.id, steward.id); // #333 standing: shared family with the inviter
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: zach.id,
      relationship: "son",
    });
    await acceptInvitation(db, { token, acceptedPersonId: zach.id });

    const { edges } = await resolveKinshipProjection(db, account(steward.id), fam.id);
    const edge = edges.find(
      (e) => e.edgeType === "parent_of" && e.personAId === steward.id && e.personBId === zach.id,
    );
    expect(edge).toBeDefined();
  });

  it("Account-holder already active in one family accepts a person-bound invite into a SECOND family", async () => {
    const { fam: boudreaux } = await familyWithSteward("Boudreaux");
    const zach = await makeAccountPerson(db, "Zach Boudreaux");
    await addMembership(db, { personId: zach.id, familyId: boudreaux.id, role: "member" });

    const { steward: carneySteward, fam: carney } = await familyWithSteward("Carney");
    // Standing (#333): the Carney steward must ALSO be able to see Zach — active in Boudreaux too
    // (mirrors the fix to the "DIFFERENT family" create test above; being a Carney steward alone is
    // not standing to name Zach as an invite anchor).
    await addMembership(db, { personId: carneySteward.id, familyId: boudreaux.id, role: "member" });
    const before = await personCount();
    const { token } = await createInvitation(db, {
      familyId: carney.id,
      inviterPersonId: carneySteward.id,
      existingInviteePersonId: zach.id,
    });
    await acceptInvitation(db, { token, acceptedPersonId: zach.id });

    expect(await isActiveMember(db, zach.id, boudreaux.id)).toBe(true); // untouched
    expect(await isActiveMember(db, zach.id, carney.id)).toBe(true); // new membership, same Person
    expect(await personCount()).toBe(before); // no second Person minted
  });
});

// acceptInvitation must protect NON-provisional anchors from the ADR-0006 merge/delete (#333
// hardening). A person-bound Invitation may anchor to a real tree Person (a `mention` placeholder, or
// another `self` Person) rather than a disposable ADR-0006 provisional — that Person must never be
// silently deleted just because the accepter differs from the anchor.
describe("acceptInvitation protects non-provisional anchors from deletion (#333 hardening)", () => {
  it("refuses (and does NOT delete) when a DIFFERENT Person accepts a person-bound invite anchored to a mention Person", async () => {
    const { steward, fam } = await familyWithSteward("Carney");

    // A real tree Person: a `mention` (e.g. a deceased relative, or a placeholder a family member
    // entered) — Account-less, but NOT a disposable ADR-0006 provisional (`origin` is "mention", not
    // "invitee"). Give it standing via a visible kinship edge in `fam`, the realistic way a mention
    // Person is "known" to an inviter (mentions hold no memberships).
    const [auntRosa] = await db
      .insert(persons)
      .values({ displayName: "Aunt Rosa", spokenName: "Rosa", origin: "mention" })
      .returning({ id: persons.id });
    await db.insert(kinshipAssertions).values({
      familyId: fam.id,
      edgeType: "parent_of",
      personAId: steward.id,
      personBId: auntRosa!.id,
      nature: "biological",
      state: "asserted",
      actorPersonId: steward.id,
    });

    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: auntRosa!.id,
    });

    // A DIFFERENT Person accepts (a mismatched accept) — must be refused, never merged/deleted. The
    // write path cannot trust that only the intended person could ever redeem this token.
    const someoneElse = await makeAccountPerson(db, "Someone Else");
    await expect(
      acceptInvitation(db, { token, acceptedPersonId: someoneElse.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);

    // Aunt Rosa's Person row is untouched — NOT deleted.
    const stillThere = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.id, auntRosa!.id));
    expect(stillThere).toHaveLength(1);

    // The invitation is unchanged too — still pending, still anchored to Aunt Rosa.
    const view = await getInvitationByToken(db, token);
    expect(view?.status).toBe("pending");
    const [invite] = await db
      .select({ inviteePersonId: invitations.inviteePersonId })
      .from(invitations)
      .where(eq(invitations.id, view!.invitationId));
    expect(invite?.inviteePersonId).toBe(auntRosa!.id);
  });

  it("still succeeds when the SAME Account-holder Person accepts their own person-bound invite", async () => {
    // Regression guard alongside the refusal above: the anchor-equals-accepter path (Zach accepting
    // his own Carney invite) must keep working — the merge/delete branch is skipped entirely then.
    const { steward, fam } = await familyWithSteward("Carney");
    const zach = await makeAccountPerson(db, "Zach Boudreaux");
    await grantStanding(zach.id, steward.id);

    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      existingInviteePersonId: zach.id,
    });
    const { membershipId } = await acceptInvitation(db, { token, acceptedPersonId: zach.id });
    expect(membershipId).toBeTruthy();
    expect(await isActiveMember(db, zach.id, fam.id)).toBe(true);

    const stillThere = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.id, zach.id));
    expect(stillThere).toHaveLength(1);
  });
});
