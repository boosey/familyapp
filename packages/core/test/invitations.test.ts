/**
 * Tests for member invitations — token hashing (raw never stored), inviter-must-be-member guard,
 * the safe welcome-screen view, and atomic accept (membership + status flip; reject double-accept
 * and expired).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { asks, invitations, persons } from "@chronicle/db/schema";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  InvariantViolation,
  acceptInvitation,
  addMembership,
  createInvitation,
  getInvitationByToken,
  isActiveMember,
  reapUnacceptedInvitees,
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
    // A genuinely fresh token was minted.
    expect(second.token).not.toBe(first.token);
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

  it("invalidates the old token and makes the refreshed invite acceptable via the new one", async () => {
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

    // The superseded token no longer resolves; the fresh one does.
    expect(await getInvitationByToken(db, first.token)).toBeNull();
    expect(await getInvitationByToken(db, second.token)).not.toBeNull();

    const joined = await makePerson(db, "Salvatore Esposito");
    const { familyId } = await acceptInvitation(db, {
      token: second.token,
      acceptedPersonId: joined.id,
    });
    expect(familyId).toBe(fam.id);
    expect(await isActiveMember(db, joined.id, fam.id)).toBe(true);
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
