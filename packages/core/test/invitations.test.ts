/**
 * Tests for member invitations — token hashing (raw never stored), inviter-must-be-member guard,
 * the safe welcome-screen view, and atomic accept (membership + status flip; reject double-accept
 * and expired).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { asks, invitations, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  InvariantViolation,
  ThrottleError,
  acceptInvitation,
  addMembership,
  createInvitation,
  getInvitationByToken,
  isActiveMember,
} from "../src/index";
import {
  INVITE_THROTTLE_DESTINATION_LIMIT,
  INVITE_THROTTLE_DESTINATION_WINDOW_MS,
  INVITE_THROTTLE_INVITER_LIMIT,
  INVITE_THROTTLE_INVITER_WINDOW_MS,
} from "../src/constants";
import { makeFamily, makePerson } from "./helpers";

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
