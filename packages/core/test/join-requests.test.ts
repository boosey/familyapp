/**
 * Tests for join requests — the steward-approval gate on discovered families. Covers the create
 * guards (discoverable, not-already-member, dedupe), steward-only approve/decline, and the atomic
 * approve (membership + status flip).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  InvariantViolation,
  addMembership,
  approveJoinRequest,
  createFamily,
  createJoinRequest,
  declineJoinRequest,
  isActiveMember,
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
