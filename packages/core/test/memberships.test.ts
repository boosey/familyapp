/**
 * Tests for the membership write/read helpers — the at-most-one-active-(person, family) invariant
 * (rejoin after an ENDED membership is allowed), plus the read projections.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  InvariantViolation,
  addMembership,
  getStewardPersonId,
  isActiveMember,
  listActiveMembershipsForPerson,
  listMembersOfFamily,
} from "../src/index";
import { endMembership, makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("addMembership", () => {
  it("adds an active membership (defaults to member)", async () => {
    const p = await makePerson(db, "P");
    const steward = await makePerson(db, "S");
    const fam = await makeFamily(db, "Fam", steward.id);
    const { membershipId } = await addMembership(db, {
      personId: p.id,
      familyId: fam.id,
    });
    expect(membershipId).toBeTruthy();
    expect(await isActiveMember(db, p.id, fam.id)).toBe(true);
    const members = await listMembersOfFamily(db, fam.id);
    expect(members.find((m) => m.personId === p.id)?.role).toBe("member");
  });

  it("rejects a second active membership for the same (person, family)", async () => {
    const p = await makePerson(db, "P");
    const steward = await makePerson(db, "S");
    const fam = await makeFamily(db, "Fam", steward.id);
    await addMembership(db, { personId: p.id, familyId: fam.id });
    await expect(
      addMembership(db, { personId: p.id, familyId: fam.id }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("allows a rejoin after a prior membership ENDED", async () => {
    const p = await makePerson(db, "P");
    const steward = await makePerson(db, "S");
    const fam = await makeFamily(db, "Fam", steward.id);
    const { membershipId } = await addMembership(db, {
      personId: p.id,
      familyId: fam.id,
    });
    await endMembership(db, membershipId);
    const rejoin = await addMembership(db, { personId: p.id, familyId: fam.id });
    expect(rejoin.membershipId).not.toBe(membershipId);
    expect(await isActiveMember(db, p.id, fam.id)).toBe(true);
  });
});

describe("read helpers", () => {
  it("listActiveMembershipsForPerson returns only active rows", async () => {
    const p = await makePerson(db, "P");
    const s = await makePerson(db, "S");
    const famA = await makeFamily(db, "A", s.id);
    const famB = await makeFamily(db, "B", s.id);
    const { membershipId } = await addMembership(db, {
      personId: p.id,
      familyId: famA.id,
    });
    await addMembership(db, { personId: p.id, familyId: famB.id });
    await endMembership(db, membershipId);
    const active = await listActiveMembershipsForPerson(db, p.id);
    expect(active.map((m) => m.familyId)).toEqual([famB.id]);
  });

  it("isActiveMember is false for a non-member", async () => {
    const p = await makePerson(db, "P");
    const s = await makePerson(db, "S");
    const fam = await makeFamily(db, "Fam", s.id);
    expect(await isActiveMember(db, p.id, fam.id)).toBe(false);
  });

  it("getStewardPersonId returns the steward, null for unknown family", async () => {
    const s = await makePerson(db, "S");
    const fam = await makeFamily(db, "Fam", s.id);
    expect(await getStewardPersonId(db, fam.id)).toBe(s.id);
    expect(
      await getStewardPersonId(db, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("listMembersOfFamily excludes ended memberships", async () => {
    const a = await makePerson(db, "A");
    const b = await makePerson(db, "B");
    const s = await makePerson(db, "S");
    const fam = await makeFamily(db, "Fam", s.id);
    await addMembership(db, { personId: a.id, familyId: fam.id });
    const { membershipId } = await addMembership(db, {
      personId: b.id,
      familyId: fam.id,
    });
    await endMembership(db, membershipId);
    const members = await listMembersOfFamily(db, fam.id);
    expect(members.map((m) => m.personId)).toEqual([a.id]);
  });
});
