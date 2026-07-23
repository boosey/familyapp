/**
 * Tests for join requests — the steward-approval gate on discovered families. Covers the create
 * guards (discoverable, not-already-member, dedupe), steward-only approve/decline, and the atomic
 * approve (membership + status flip).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { invitations, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  InvariantViolation,
  acceptInvitation,
  addMembership,
  approveJoinRequest,
  createAccountWithPerson,
  createFamily,
  createInvitation,
  createJoinRequest,
  declineJoinRequest,
  isActiveMember,
  listActiveMembershipsForPerson,
  listDecidedJoinRequestsForSteward,
  listJoinRequestsByRequester,
  listPendingJoinRequestsForSteward,
} from "../src/index";
import { makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** A discoverable family with its steward, returning ids. */
async function discoverableFamily() {
  const steward = await makePerson(db, "Rosa");
  const { familyId } = await createFamily(db, {
    name: "Esposito",
    discoverable: true,
    creatorPersonId: steward.id,
  });
  return { steward, familyId };
}

describe("createJoinRequest", () => {
  it("creates a pending request against a discoverable family", async () => {
    const { familyId } = await discoverableFamily();
    const requester = await makePerson(db, "Cousin");
    const { joinRequestId } = await createJoinRequest(db, {
      familyId,
      requesterPersonId: requester.id,
      message: "I'm Rosa's cousin",
    });
    expect(joinRequestId).toBeTruthy();
    const own = await listJoinRequestsByRequester(db, requester.id);
    expect(own).toHaveLength(1);
    expect(own[0]?.status).toBe("pending");
    expect(own[0]?.familyName).toBe("Esposito");
  });

  it("rejects a request to a non-discoverable family", async () => {
    const steward = await makePerson(db, "Rosa");
    const { familyId } = await createFamily(db, {
      name: "Private",
      creatorPersonId: steward.id,
    });
    const requester = await makePerson(db, "Cousin");
    await expect(
      createJoinRequest(db, { familyId, requesterPersonId: requester.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("rejects a request from an existing active member", async () => {
    const { familyId } = await discoverableFamily();
    const member = await makePerson(db, "Member");
    await addMembership(db, { personId: member.id, familyId });
    await expect(
      createJoinRequest(db, { familyId, requesterPersonId: member.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("rejects a duplicate pending request", async () => {
    const { familyId } = await discoverableFamily();
    const requester = await makePerson(db, "Cousin");
    await createJoinRequest(db, { familyId, requesterPersonId: requester.id });
    await expect(
      createJoinRequest(db, { familyId, requesterPersonId: requester.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("rejects an unknown family", async () => {
    const requester = await makePerson(db, "Cousin");
    await expect(
      createJoinRequest(db, {
        familyId: "00000000-0000-0000-0000-000000000000",
        requesterPersonId: requester.id,
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});

describe("listPendingJoinRequestsForSteward", () => {
  it("lists pending requests across the steward's families", async () => {
    const { steward, familyId } = await discoverableFamily();
    const r1 = await makePerson(db, "Aldo");
    const r2 = await makePerson(db, "Bea");
    await createJoinRequest(db, { familyId, requesterPersonId: r1.id });
    await createJoinRequest(db, { familyId, requesterPersonId: r2.id });
    const pending = await listPendingJoinRequestsForSteward(db, steward.id);
    expect(pending).toHaveLength(2);
    expect(new Set(pending.map((p) => p.requesterName))).toEqual(
      new Set(["Aldo", "Bea"]),
    );
  });

  it("excludes requests for families this person does not steward", async () => {
    const { familyId } = await discoverableFamily();
    const otherSteward = await makePerson(db, "Other");
    const requester = await makePerson(db, "Cousin");
    await createJoinRequest(db, { familyId, requesterPersonId: requester.id });
    expect(
      await listPendingJoinRequestsForSteward(db, otherSteward.id),
    ).toHaveLength(0);
  });
});

describe("approveJoinRequest", () => {
  it("creates the membership and flips status to approved", async () => {
    const { steward, familyId } = await discoverableFamily();
    const requester = await makePerson(db, "Cousin");
    const { joinRequestId } = await createJoinRequest(db, {
      familyId,
      requesterPersonId: requester.id,
    });
    const { membershipId } = await approveJoinRequest(db, {
      joinRequestId,
      deciderPersonId: steward.id,
    });
    expect(membershipId).toBeTruthy();
    expect(await isActiveMember(db, requester.id, familyId)).toBe(true);
    const own = await listJoinRequestsByRequester(db, requester.id);
    expect(own[0]?.status).toBe("approved");
  });

  it("rejects approval by a non-steward", async () => {
    const { familyId } = await discoverableFamily();
    const requester = await makePerson(db, "Cousin");
    const interloper = await makePerson(db, "Nobody");
    const { joinRequestId } = await createJoinRequest(db, {
      familyId,
      requesterPersonId: requester.id,
    });
    await expect(
      approveJoinRequest(db, { joinRequestId, deciderPersonId: interloper.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects approving an already-decided request", async () => {
    const { steward, familyId } = await discoverableFamily();
    const requester = await makePerson(db, "Cousin");
    const { joinRequestId } = await createJoinRequest(db, {
      familyId,
      requesterPersonId: requester.id,
    });
    await approveJoinRequest(db, { joinRequestId, deciderPersonId: steward.id });
    await expect(
      approveJoinRequest(db, { joinRequestId, deciderPersonId: steward.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});

describe("declineJoinRequest", () => {
  it("flips status to declined and creates no membership", async () => {
    const { steward, familyId } = await discoverableFamily();
    const requester = await makePerson(db, "Cousin");
    const { joinRequestId } = await createJoinRequest(db, {
      familyId,
      requesterPersonId: requester.id,
    });
    await declineJoinRequest(db, { joinRequestId, deciderPersonId: steward.id });
    expect(await isActiveMember(db, requester.id, familyId)).toBe(false);
    const own = await listJoinRequestsByRequester(db, requester.id);
    expect(own[0]?.status).toBe("declined");
  });

  it("rejects decline by a non-steward", async () => {
    const { familyId } = await discoverableFamily();
    const requester = await makePerson(db, "Cousin");
    const interloper = await makePerson(db, "Nobody");
    const { joinRequestId } = await createJoinRequest(db, {
      familyId,
      requesterPersonId: requester.id,
    });
    await expect(
      declineJoinRequest(db, { joinRequestId, deciderPersonId: interloper.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("listJoinRequestsByRequester", () => {
  it("carries the steward name so the requester can see who to wait on", async () => {
    const { familyId } = await discoverableFamily(); // steward "Rosa"
    const requester = await makePerson(db, "Cousin");
    await createJoinRequest(db, { familyId, requesterPersonId: requester.id });
    const own = await listJoinRequestsByRequester(db, requester.id);
    expect(own).toHaveLength(1);
    expect(own[0]?.stewardName).toBe("Rosa");
  });
});

describe("listDecidedJoinRequestsForSteward", () => {
  it("lists decided requests and excludes still-pending ones", async () => {
    const { steward, familyId } = await discoverableFamily();
    const approved = await makePerson(db, "Approved One");
    const declined = await makePerson(db, "Declined One");
    const stillPending = await makePerson(db, "Pending One");
    const a = await createJoinRequest(db, { familyId, requesterPersonId: approved.id });
    const d = await createJoinRequest(db, { familyId, requesterPersonId: declined.id });
    await createJoinRequest(db, { familyId, requesterPersonId: stillPending.id });

    await approveJoinRequest(db, { joinRequestId: a.joinRequestId, deciderPersonId: steward.id });
    await declineJoinRequest(db, { joinRequestId: d.joinRequestId, deciderPersonId: steward.id });

    const decided = await listDecidedJoinRequestsForSteward(db, steward.id);
    expect(decided).toHaveLength(2);
    const byName = new Map(decided.map((r) => [r.requesterName, r.status]));
    expect(byName.get("Approved One")).toBe("approved");
    expect(byName.get("Declined One")).toBe("declined");
    expect(byName.has("Pending One")).toBe(false);
    // Still-pending remains visible on the pending list.
    const pending = await listPendingJoinRequestsForSteward(db, steward.id);
    expect(pending.map((p) => p.requesterName)).toEqual(["Pending One"]);
  });

  it("excludes decided requests for families this person does not steward", async () => {
    const { steward, familyId } = await discoverableFamily();
    const requester = await makePerson(db, "Cousin");
    const other = await makePerson(db, "Other");
    const { joinRequestId } = await createJoinRequest(db, {
      familyId,
      requesterPersonId: requester.id,
    });
    await declineJoinRequest(db, { joinRequestId, deciderPersonId: steward.id });
    expect(await listDecidedJoinRequestsForSteward(db, other.id)).toHaveLength(0);
  });

  it("honors the limit", async () => {
    const { steward, familyId } = await discoverableFamily();
    const r1 = await makePerson(db, "One");
    const r2 = await makePerson(db, "Two");
    const j1 = await createJoinRequest(db, { familyId, requesterPersonId: r1.id });
    const j2 = await createJoinRequest(db, { familyId, requesterPersonId: r2.id });
    await declineJoinRequest(db, { joinRequestId: j1.joinRequestId, deciderPersonId: steward.id });
    await declineJoinRequest(db, { joinRequestId: j2.joinRequestId, deciderPersonId: steward.id });
    expect(await listDecidedJoinRequestsForSteward(db, steward.id, { limit: 1 })).toHaveLength(1);
    expect(await listDecidedJoinRequestsForSteward(db, steward.id, { limit: 0 })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// #354 — auto-approve on a matching invitation.
// The production incident: an owner invited their sister; she signed up and used the discovery
// "request to join" route instead of tapping the invite link, so the owner got a redundant approval
// request for someone they had already vouched for. An invited person (verified-contact match on a
// live invitation from the same family) is auto-approved instead of queued.
// ---------------------------------------------------------------------------

/** An account-backed requester with a verified email (the only kind the matcher trusts). */
async function accountRequester(
  email: string,
  displayName = "Robyn",
  opts: { verified?: boolean } = {},
) {
  const { personId } = await createAccountWithPerson(db, {
    provider: "clerk",
    authProviderUserId: `user_${email}`,
    email,
    emailVerified: opts.verified ?? true,
    displayName,
  });
  return personId;
}

describe("createJoinRequest — auto-approve on a matching invitation (#354)", () => {
  it("auto-approves, creates the membership, and stamps viaInvitationId", async () => {
    const { steward, familyId } = await discoverableFamily();
    await createInvitation(db, {
      familyId,
      inviterPersonId: steward.id,
      inviteeName: "Robyn",
      inviteeEmail: "robyn@example.com",
    });
    const requester = await accountRequester("robyn@example.com");

    const res = await createJoinRequest(db, { familyId, requesterPersonId: requester });
    expect(res.autoApproved).toBe(true);
    expect(await isActiveMember(db, requester, familyId)).toBe(true);

    // The steward is never asked — nothing pending; the decided row reads approved-by-invitation.
    expect(await listPendingJoinRequestsForSteward(db, steward.id)).toHaveLength(0);
    const decided = await listDecidedJoinRequestsForSteward(db, steward.id);
    expect(decided).toHaveLength(1);
    expect(decided[0]?.status).toBe("approved");
    expect(decided[0]?.requesterName).toBe("Robyn");
    expect(decided[0]?.viaInvitationId).not.toBeNull();

    // The invitation is consumed (accepted), so the emailed link is now spent.
    const [invite] = await db
      .select({ status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, decided[0]!.viaInvitationId!))
      .limit(1);
    expect(invite?.status).toBe("accepted");
  });

  it("does NOT auto-approve when there is no matching invitation (normal pending gate)", async () => {
    const { steward, familyId } = await discoverableFamily();
    const requester = await accountRequester("stranger@example.com", "Stranger");

    const res = await createJoinRequest(db, { familyId, requesterPersonId: requester });
    expect(res.autoApproved).toBe(false);
    expect(await isActiveMember(db, requester, familyId)).toBe(false);
    const pending = await listPendingJoinRequestsForSteward(db, steward.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.requesterName).toBe("Stranger");
  });

  it("does NOT auto-approve on an UNVERIFIED contact match (a match is not proof of identity)", async () => {
    const { steward, familyId } = await discoverableFamily();
    await createInvitation(db, {
      familyId,
      inviterPersonId: steward.id,
      inviteeName: "Robyn",
      inviteeEmail: "robyn@example.com",
    });
    // Same email, but the account never verified it — the matcher must ignore it.
    const requester = await accountRequester("robyn@example.com", "Robyn", { verified: false });

    const res = await createJoinRequest(db, { familyId, requesterPersonId: requester });
    expect(res.autoApproved).toBe(false);
    expect(await listPendingJoinRequestsForSteward(db, steward.id)).toHaveLength(1);
  });

  it("consumes the invitation so the emailed link cannot mint a SECOND membership", async () => {
    const { steward, familyId } = await discoverableFamily();
    const { token } = await createInvitation(db, {
      familyId,
      inviterPersonId: steward.id,
      inviteeName: "Robyn",
      inviteeEmail: "robyn@example.com",
    });
    const requester = await accountRequester("robyn@example.com");

    await createJoinRequest(db, { familyId, requesterPersonId: requester });
    // The still-outstanding link, tapped after the fact, must not create a duplicate membership.
    await expect(
      acceptInvitation(db, { token, acceptedPersonId: requester }),
    ).rejects.toBeInstanceOf(InvariantViolation);
    expect(await listActiveMembershipsForPerson(db, requester)).toHaveLength(1);
  });

  it("does NOT auto-approve (and does NOT throw) when the invite anchors to a real tree node, not a disposable provisional", async () => {
    // Reproduces the production incident exactly: the invitee was ALREADY a `mention` tree node
    // (person-bound invite, #333), distinct from the requester's account Person. acceptResolvedInvitation
    // would REFUSE to merge/delete that node (it's a real Person, not a throwaway) — so auto-approve must
    // skip this invite rather than throw, leaving a normal pending request for the steward to approve.
    const { steward, familyId } = await discoverableFamily();
    const { inviteePersonId } = await createInvitation(db, {
      familyId,
      inviterPersonId: steward.id,
      inviteeName: "Robyn",
      inviteeEmail: "robyn@example.com",
    });
    // Turn the freshly-minted provisional into a NON-disposable anchor (a real tree node).
    await db
      .update(persons)
      .set({ origin: "mention" })
      .where(eq(persons.id, inviteePersonId));
    // The requester is a DIFFERENT Person (their own account), whose verified email matches the invite.
    const requester = await accountRequester("robyn@example.com", "Robyn Amrhein");

    const res = await createJoinRequest(db, { familyId, requesterPersonId: requester });
    expect(res.autoApproved).toBe(false);
    expect(await isActiveMember(db, requester, familyId)).toBe(false);
    // Falls through to the normal steward gate — a pending request, no auto-approve, no crash.
    const pending = await listPendingJoinRequestsForSteward(db, steward.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.requesterName).toBe("Robyn Amrhein");
  });
});
