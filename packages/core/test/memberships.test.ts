/**
 * Tests for the membership write/read helpers — the at-most-one-active-(person, family) invariant
 * (rejoin after an ENDED membership is allowed), plus the read projections.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { memberships } from "@chronicle/db/schema";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  InvariantViolation,
  addMembership,
  designateNarrator,
  endMembership,
  getStewardPersonId,
  isActiveMember,
  listActiveFamiliesForPerson,
  listActiveMembershipsForPerson,
  listMembersOfFamily,
  setMemberNonFamily,
} from "../src/index";
// The LOCAL test helper `forceEndMembership(db, membershipId)` ends a membership by RAW id (a test
// convenience). It is distinct from the CORE `endMembership(db, ctx, {familyId, personId})` above,
// which is steward-gated and the function under test — so we import the core one and keep the raw
// helper under a non-colliding name.
import { forceEndMembership, makeFamily, makePerson } from "./helpers";

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
    await forceEndMembership(db, membershipId);
    const rejoin = await addMembership(db, { personId: p.id, familyId: fam.id });
    expect(rejoin.membershipId).not.toBe(membershipId);
    expect(await isActiveMember(db, p.id, fam.id)).toBe(true);
  });
});

describe("designateNarrator", () => {
  it("promotes an existing active member's role to narrator", async () => {
    const p = await makePerson(db, "P");
    const steward = await makePerson(db, "S");
    const fam = await makeFamily(db, "Fam", steward.id);
    await addMembership(db, { personId: p.id, familyId: fam.id }); // defaults to member

    await designateNarrator(db, { personId: p.id, familyId: fam.id });

    const members = await listMembersOfFamily(db, fam.id);
    expect(members.find((m) => m.personId === p.id)?.role).toBe("narrator");
    // Still exactly one active membership — designation edits the role, never adds a row.
    const active = await listActiveMembershipsForPerson(db, p.id);
    expect(active).toHaveLength(1);
  });

  it("is idempotent — designating an already-narrator member is a no-op success", async () => {
    const p = await makePerson(db, "P");
    const steward = await makePerson(db, "S");
    const fam = await makeFamily(db, "Fam", steward.id);
    await addMembership(db, { personId: p.id, familyId: fam.id, role: "narrator" });

    await expect(
      designateNarrator(db, { personId: p.id, familyId: fam.id }),
    ).resolves.toBeUndefined();

    const members = await listMembersOfFamily(db, fam.id);
    expect(members.find((m) => m.personId === p.id)?.role).toBe("narrator");
    const active = await listActiveMembershipsForPerson(db, p.id);
    expect(active).toHaveLength(1);
  });

  it("rejects designating a person who has no active membership in the family", async () => {
    const p = await makePerson(db, "P");
    const steward = await makePerson(db, "S");
    const fam = await makeFamily(db, "Fam", steward.id);
    // p is NOT a member of fam.
    await expect(
      designateNarrator(db, { personId: p.id, familyId: fam.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("does not resurrect an ENDED membership (an ended member is not designable)", async () => {
    const p = await makePerson(db, "P");
    const steward = await makePerson(db, "S");
    const fam = await makeFamily(db, "Fam", steward.id);
    const { membershipId } = await addMembership(db, { personId: p.id, familyId: fam.id });
    await forceEndMembership(db, membershipId);

    await expect(
      designateNarrator(db, { personId: p.id, familyId: fam.id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await isActiveMember(db, p.id, fam.id)).toBe(false);
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
    await forceEndMembership(db, membershipId);
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
    await forceEndMembership(db, membershipId);
    const members = await listMembersOfFamily(db, fam.id);
    expect(members.map((m) => m.personId)).toEqual([a.id]);
  });
});

describe("listActiveFamiliesForPerson", () => {
  it("returns the person's active families with names, sorted by name then id", async () => {
    const p = await makePerson(db, "P");
    const s = await makePerson(db, "S");
    // Insert in an order that is neither name- nor id-sorted, to prove the JS sort.
    const zulu = await makeFamily(db, "Zulu", s.id);
    const alpha = await makeFamily(db, "Alpha", s.id);
    await addMembership(db, { personId: p.id, familyId: zulu.id });
    await addMembership(db, { personId: p.id, familyId: alpha.id });

    const active = await listActiveFamiliesForPerson(db, p.id);
    expect(active).toEqual([
      { familyId: alpha.id, familyName: "Alpha", familyShortName: null },
      { familyId: zulu.id, familyName: "Zulu", familyShortName: null },
    ]);
  });

  it("breaks a name tie by familyId", async () => {
    const p = await makePerson(db, "P");
    const s = await makePerson(db, "S");
    const one = await makeFamily(db, "Same", s.id);
    const two = await makeFamily(db, "Same", s.id);
    await addMembership(db, { personId: p.id, familyId: one.id });
    await addMembership(db, { personId: p.id, familyId: two.id });

    const active = await listActiveFamiliesForPerson(db, p.id);
    const sortedIds = [one.id, two.id].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(active.map((f) => f.familyId)).toEqual(sortedIds);
  });

  it("excludes ended memberships", async () => {
    const p = await makePerson(db, "P");
    const s = await makePerson(db, "S");
    const kept = await makeFamily(db, "Kept", s.id);
    const gone = await makeFamily(db, "Gone", s.id);
    await addMembership(db, { personId: p.id, familyId: kept.id });
    const { membershipId } = await addMembership(db, {
      personId: p.id,
      familyId: gone.id,
    });
    await forceEndMembership(db, membershipId);

    const active = await listActiveFamiliesForPerson(db, p.id);
    expect(active.map((f) => f.familyId)).toEqual([kept.id]);
  });

  it("excludes other people's families", async () => {
    const p = await makePerson(db, "P");
    const other = await makePerson(db, "Other");
    const s = await makePerson(db, "S");
    const mine = await makeFamily(db, "Mine", s.id);
    const theirs = await makeFamily(db, "Theirs", s.id);
    await addMembership(db, { personId: p.id, familyId: mine.id });
    await addMembership(db, { personId: other.id, familyId: theirs.id });

    const active = await listActiveFamiliesForPerson(db, p.id);
    expect(active.map((f) => f.familyId)).toEqual([mine.id]);
  });

  it("returns [] for a person with no active membership", async () => {
    const p = await makePerson(db, "P");
    expect(await listActiveFamiliesForPerson(db, p.id)).toEqual([]);
  });
});

const account = (personId: string) => ({ kind: "account", personId }) as const;

/** The `non_family` flag / status / ended_at of the CURRENT active row (or a resolved ended one). */
async function membershipRow(db: Database, personId: string, familyId: string) {
  const [row] = await db
    .select({
      status: memberships.status,
      nonFamily: memberships.nonFamily,
      endedAt: memberships.endedAt,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.personId, personId),
        eq(memberships.familyId, familyId),
      ),
    )
    .limit(1);
  return row!;
}

describe("setMemberNonFamily (#161)", () => {
  it("toggles the non_family flag on the target's active membership; reversible", async () => {
    const steward = await makePerson(db, "S");
    const member = await makePerson(db, "M");
    const fam = await makeFamily(db, "Fam", steward.id);
    await addMembership(db, { personId: steward.id, familyId: fam.id });
    await addMembership(db, { personId: member.id, familyId: fam.id });

    expect((await membershipRow(db, member.id, fam.id)).nonFamily).toBe(false);

    // Any active member (here the steward) may curate.
    await setMemberNonFamily(db, account(steward.id), {
      familyId: fam.id,
      personId: member.id,
      nonFamily: true,
    });
    expect((await membershipRow(db, member.id, fam.id)).nonFamily).toBe(true);

    // Reversible.
    await setMemberNonFamily(db, account(steward.id), {
      familyId: fam.id,
      personId: member.id,
      nonFamily: false,
    });
    expect((await membershipRow(db, member.id, fam.id)).nonFamily).toBe(false);
  });

  it("a NON-steward active member may also curate", async () => {
    const steward = await makePerson(db, "S");
    const a = await makePerson(db, "A");
    const b = await makePerson(db, "B");
    const fam = await makeFamily(db, "Fam", steward.id);
    await addMembership(db, { personId: a.id, familyId: fam.id });
    await addMembership(db, { personId: b.id, familyId: fam.id });

    // `a` (a plain member, not steward) marks `b` non-family.
    await setMemberNonFamily(db, account(a.id), {
      familyId: fam.id,
      personId: b.id,
      nonFamily: true,
    });
    expect((await membershipRow(db, b.id, fam.id)).nonFamily).toBe(true);
  });

  it("rejects a non-member actor", async () => {
    const steward = await makePerson(db, "S");
    const member = await makePerson(db, "M");
    const stranger = await makePerson(db, "X");
    const fam = await makeFamily(db, "Fam", steward.id);
    await addMembership(db, { personId: member.id, familyId: fam.id });

    await expect(
      setMemberNonFamily(db, account(stranger.id), {
        familyId: fam.id,
        personId: member.id,
        nonFamily: true,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect((await membershipRow(db, member.id, fam.id)).nonFamily).toBe(false);
  });
});

describe("endMembership (#161)", () => {
  it("steward ends a member: status=ended + ended_at set; access is revoked", async () => {
    const steward = await makePerson(db, "S");
    const member = await makePerson(db, "M");
    const fam = await makeFamily(db, "Fam", steward.id);
    await addMembership(db, { personId: steward.id, familyId: fam.id });
    await addMembership(db, { personId: member.id, familyId: fam.id });
    expect(await isActiveMember(db, member.id, fam.id)).toBe(true);

    await endMembership(db, account(steward.id), {
      familyId: fam.id,
      personId: member.id,
    });

    const row = await membershipRow(db, member.id, fam.id);
    expect(row.status).toBe("ended");
    expect(row.endedAt).not.toBeNull();
    // Access revocation is automatic — the active-membership gate now fails.
    expect(await isActiveMember(db, member.id, fam.id)).toBe(false);
  });

  it("rejects a non-steward member (steward-only)", async () => {
    const steward = await makePerson(db, "S");
    const member = await makePerson(db, "M");
    const other = await makePerson(db, "O");
    const fam = await makeFamily(db, "Fam", steward.id);
    await addMembership(db, { personId: member.id, familyId: fam.id });
    await addMembership(db, { personId: other.id, familyId: fam.id });

    // A plain member cannot remove another member.
    await expect(
      endMembership(db, account(other.id), {
        familyId: fam.id,
        personId: member.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await isActiveMember(db, member.id, fam.id)).toBe(true);
  });

  it("rejects an anonymous actor", async () => {
    const steward = await makePerson(db, "S");
    const member = await makePerson(db, "M");
    const fam = await makeFamily(db, "Fam", steward.id);
    await addMembership(db, { personId: member.id, familyId: fam.id });

    await expect(
      endMembership(db, { kind: "anonymous" }, {
        familyId: fam.id,
        personId: member.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("the steward cannot end their OWN membership (would leave the family stewardless)", async () => {
    const steward = await makePerson(db, "S");
    const fam = await makeFamily(db, "Fam", steward.id); // steward is the family steward
    await addMembership(db, { personId: steward.id, familyId: fam.id });
    expect(await isActiveMember(db, steward.id, fam.id)).toBe(true);

    await expect(
      endMembership(db, account(steward.id), {
        familyId: fam.id,
        personId: steward.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    // Still active — the guard blocked the self-removal.
    expect(await isActiveMember(db, steward.id, fam.id)).toBe(true);
  });
});
