/**
 * Tests for member invitations — token hashing (raw never stored), inviter-must-be-member guard,
 * the safe welcome-screen view, and atomic accept (membership + status flip; reject double-accept
 * and expired).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { invitations } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  InvariantViolation,
  acceptInvitation,
  addMembership,
  createInvitation,
  getInvitationByToken,
  isActiveMember,
} from "../src/index";
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

  it("rejects an inviter who is not an active member", async () => {
    const { fam } = await familyWithSteward();
    const stranger = await makePerson(db, "Stranger");
    await expect(
      createInvitation(db, { familyId: fam.id, inviterPersonId: stranger.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
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
});
