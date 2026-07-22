/**
 * Tests for #164 (ADR-0023): an invitation carries a STRUCTURED relationship, and acceptance
 * auto-places the new member on the family tree — the kinship edge + the invitee's `sex`.
 *
 * Behavior is asserted at the highest seam: `createInvitation({relationship})` → `acceptInvitation`
 * → the resulting kinship edge (correct type + DIRECTION) and the invitee's `sex`, read back through
 * the same kinship projection the tree renders — never how they were computed. All fixtures are
 * PGlite (real Postgres in-process).
 */
import { createTestDatabase, type Database, type InviteRelationship } from "@chronicle/db";
import { accounts, invitations, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  addMembership,
  correctEdge,
  createInvitation,
  denyEdge,
  endMembership,
  hideEdge,
  planInviteAcceptPlacement,
  resolveKinshipProjection,
  type AuthContext,
  type ResolvedKinshipEdge,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string): AuthContext => ({ kind: "account", personId });

/** Steward + family with the steward (= the inviter/actor) as an active member. */
async function familyWithSteward(name = "Esposito") {
  const steward = await makePerson(db, "Rosa Esposito");
  const fam = await makeFamily(db, name, steward.id);
  await addMembership(db, { personId: steward.id, familyId: fam.id, role: "steward" });
  return { steward, fam };
}

/** An account-bearing Person — needed for the subject-hide veto (a mention/accountless person has no
 *  hide control). Returns the Person row; the accepting invitee uses this so it can hide its edge. */
async function makeAccountPerson(displayName: string) {
  const [acct] = await db
    .insert(accounts)
    .values({ authProviderUserId: `user_${Math.random()}`, email: `${Math.random()}@x.com` })
    .returning({ id: accounts.id });
  const [person] = await db
    .insert(persons)
    .values({ displayName, spokenName: displayName, accountId: acct!.id })
    .returning();
  return person!;
}

/** The invitee's current `sex` (the placement side-effect). */
async function inviteeSex(personId: string): Promise<string | null> {
  const [row] = await db
    .select({ sex: persons.sex })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  return row?.sex ?? null;
}

/** The family's current kinship edges as the steward (an active member) sees them. */
async function edgesOf(fam: string, viewer: string): Promise<ResolvedKinshipEdge[]> {
  const { edges } = await resolveKinshipProjection(db, account(viewer), fam);
  return edges;
}

/** Drive an invite with a structured relationship all the way to an accepted membership. Returns the
 *  inviter (steward), the family, and the freshly-accepted invitee Person id. */
async function inviteAndAccept(
  relationship: InviteRelationship,
  opts?: { invitee?: { id: string } },
) {
  const { steward, fam } = await familyWithSteward();
  const { token } = await createInvitation(db, {
    familyId: fam.id,
    inviterPersonId: steward.id,
    inviteeName: "New Member",
    relationship,
  });
  const invitee = opts?.invitee ?? (await makePerson(db, "New Member"));
  await acceptInvitation(db, { token, acceptedPersonId: invitee.id });
  return { steward, fam, inviteeId: invitee.id };
}

describe("createInvitation persists the structured relationship (#164)", () => {
  it("stores the machine-readable relationship on the row", async () => {
    const { steward, fam } = await familyWithSteward();
    const { invitationId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
      relationship: "son",
    });
    const [row] = await db
      .select({ inviteRelationship: invitations.inviteRelationship })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    expect(row?.inviteRelationship).toBe("son");
  });

  it("carries the relationship through a re-invite dedup refresh", async () => {
    const { steward, fam } = await familyWithSteward();
    await createInvitation(db, {
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
      relationship: "father",
    });
    const [row] = await db
      .select({ inviteRelationship: invitations.inviteRelationship })
      .from(invitations)
      .where(eq(invitations.id, second.invitationId))
      .limit(1);
    expect(row?.inviteRelationship).toBe("father");
  });
});

describe("acceptInvitation auto-places the member — direct relationships (#164)", () => {
  it("son ⇒ inviter is parent_of invitee; invitee sex = male", async () => {
    const { steward, inviteeId, fam } = await inviteAndAccept("son");
    const edges = await edgesOf(fam.id, steward.id);
    const edge = edges.find(
      (e) => e.edgeType === "parent_of" && e.personAId === steward.id && e.personBId === inviteeId,
    );
    expect(edge).toBeDefined();
    expect(await inviteeSex(inviteeId)).toBe("male");
  });

  it("daughter ⇒ inviter is parent_of invitee; invitee sex = female", async () => {
    const { steward, inviteeId, fam } = await inviteAndAccept("daughter");
    const edges = await edgesOf(fam.id, steward.id);
    const edge = edges.find(
      (e) => e.edgeType === "parent_of" && e.personAId === steward.id && e.personBId === inviteeId,
    );
    expect(edge).toBeDefined();
    expect(await inviteeSex(inviteeId)).toBe("female");
  });

  it("mother ⇒ invitee is parent_of inviter; invitee sex = female", async () => {
    const { steward, inviteeId, fam } = await inviteAndAccept("mother");
    const edges = await edgesOf(fam.id, steward.id);
    const edge = edges.find(
      (e) => e.edgeType === "parent_of" && e.personAId === inviteeId && e.personBId === steward.id,
    );
    expect(edge).toBeDefined();
    expect(await inviteeSex(inviteeId)).toBe("female");
  });

  it("father ⇒ invitee is parent_of inviter; invitee sex = male", async () => {
    const { steward, inviteeId, fam } = await inviteAndAccept("father");
    const edges = await edgesOf(fam.id, steward.id);
    const edge = edges.find(
      (e) => e.edgeType === "parent_of" && e.personAId === inviteeId && e.personBId === steward.id,
    );
    expect(edge).toBeDefined();
    expect(await inviteeSex(inviteeId)).toBe("male");
  });

  it("wife ⇒ partnered_with(inviter, invitee); invitee sex = female", async () => {
    const { steward, inviteeId, fam } = await inviteAndAccept("wife");
    const edges = await edgesOf(fam.id, steward.id);
    const pair = new Set([steward.id, inviteeId]);
    const edge = edges.find(
      (e) => e.edgeType === "partnered_with" && pair.has(e.personAId) && pair.has(e.personBId),
    );
    expect(edge).toBeDefined();
    expect(await inviteeSex(inviteeId)).toBe("female");
  });

  it("husband ⇒ partnered_with(inviter, invitee); invitee sex = male", async () => {
    const { steward, inviteeId, fam } = await inviteAndAccept("husband");
    const edges = await edgesOf(fam.id, steward.id);
    const pair = new Set([steward.id, inviteeId]);
    const edge = edges.find(
      (e) => e.edgeType === "partnered_with" && pair.has(e.personAId) && pair.has(e.personBId),
    );
    expect(edge).toBeDefined();
    expect(await inviteeSex(inviteeId)).toBe("male");
  });
});

describe("acceptInvitation leaves 'other' and unset relationships unplaced (#164)", () => {
  it("other ⇒ NO edge is created and sex is unchanged", async () => {
    const { steward, inviteeId, fam } = await inviteAndAccept("other");
    const edges = await edgesOf(fam.id, steward.id);
    expect(edges).toHaveLength(0);
    expect(await inviteeSex(inviteeId)).toBe("unknown");
  });

  it("a relationship-less invite (legacy / no pick) auto-places nothing", async () => {
    const { steward, fam } = await familyWithSteward();
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Sal",
    });
    const invitee = await makePerson(db, "Sal");
    await acceptInvitation(db, { token, acceptedPersonId: invitee.id });
    const edges = await edgesOf(fam.id, steward.id);
    expect(edges).toHaveLength(0);
  });
});

describe("the auto-edge is NOT privileged — governance overlay still applies (#164)", () => {
  it("a subject can hide the auto-created edge (the hide veto holds)", async () => {
    // The invitee needs an account for the hide control to exist.
    const invitee = await makeAccountPerson("Sal");
    const { steward, inviteeId, fam } = await inviteAndAccept("son", { invitee });
    // The invitee is an active member after accept; the hide is theirs to cast.
    const res = await hideEdge(db, account(inviteeId), {
      familyId: fam.id,
      edgeType: "parent_of",
      personAId: steward.id,
      personBId: inviteeId,
    });
    expect(res.allowed).toBe(true);
    const edges = await edgesOf(fam.id, steward.id);
    expect(edges).toHaveLength(0); // hidden family-wide
  });

  it("the steward can deny the auto-created edge", async () => {
    const { steward, inviteeId, fam } = await inviteAndAccept("son");
    const res = await denyEdge(db, account(steward.id), {
      familyId: fam.id,
      edgeType: "parent_of",
      personAId: steward.id,
      personBId: inviteeId,
    });
    expect(res.allowed).toBe(true);
    const edges = await edgesOf(fam.id, steward.id);
    expect(edges).toHaveLength(0); // denied edges drop from the projection
  });

  it("the steward can correct the auto-created edge's nature", async () => {
    const { steward, inviteeId, fam } = await inviteAndAccept("daughter");
    const res = await correctEdge(db, account(steward.id), {
      ref: {
        familyId: fam.id,
        edgeType: "parent_of",
        personAId: steward.id,
        personBId: inviteeId,
      },
      nature: "adoptive",
    });
    expect(res.allowed).toBe(true);
    const edges = await edgesOf(fam.id, steward.id);
    const edge = edges.find(
      (e) => e.edgeType === "parent_of" && e.personAId === steward.id && e.personBId === inviteeId,
    );
    expect(edge?.nature).toBe("adoptive"); // still visible, corrected nature
  });
});

// Regression: the exact production incident. An invite that said "Son" was accepted, but acceptance
// discarded the relationship and created NO edge — so the member was invisible in the Family tab
// (which renders only the kinship graph). This encodes the fix: no manual DB write, the member is in
// the family's kinship projection with the correct parent_of edge the instant they accept.
describe("regression: an invite that said 'son' places the member on the tree at accept (#164)", () => {
  it("the accepted member appears in the family's kinship read with a parent_of edge", async () => {
    const { steward, fam } = await familyWithSteward();
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Alex",
      inviteeEmail: "alexboudreaux19@example.com",
      relationship: "son",
    });
    const alex = await makePerson(db, "Alex Boudreaux");
    await acceptInvitation(db, { token, acceptedPersonId: alex.id });

    // No manual kinship write — read straight from the projection the Family tab renders.
    const edges = await edgesOf(fam.id, steward.id);
    const placed = edges.some(
      (e) => e.edgeType === "parent_of" && e.personAId === steward.id && e.personBId === alex.id,
    );
    expect(placed).toBe(true);
  });
});

// #320 — invite-accept uses the shared generative write path (writeRelationEdges), not a parallel
// insert dialect. ADR-0023 exclusions stay as adapter policy: only direct parent/child/partner.
describe("invite-accept shared generative path (#320)", () => {
  it("ADR-0023 adapter maps only direct primitives — never sibling/grandparent", () => {
    const relations = (
      ["wife", "husband", "mother", "father", "son", "daughter"] as const
    ).map((r) => planInviteAcceptPlacement(r).relation);
    expect(new Set(relations)).toEqual(new Set(["partner", "parent", "child"]));
    expect(relations).not.toContain("sibling");
    expect(relations).not.toContain("grandparent");
  });

  it("accept-as-mother yields one parent_of edge via shared nature default; no second Person minted", async () => {
    const { steward, fam } = await familyWithSteward();
    const invitee = await makePerson(db, "Maria Mother");
    const personsBefore = (await db.select({ id: persons.id }).from(persons)).length;

    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Maria Mother",
      relationship: "mother",
    });
    await acceptInvitation(db, { token, acceptedPersonId: invitee.id });

    const edges = await edgesOf(fam.id, steward.id);
    const parentEdges = edges.filter((e) => e.edgeType === "parent_of");
    expect(parentEdges).toHaveLength(1);
    expect(parentEdges[0]).toMatchObject({
      personAId: invitee.id,
      personBId: steward.id,
      // Shared generative default (defaultParentChildNature) — not an invite-forked "unknown".
      nature: "biological",
    });
    // No ADR-0017 bridge/placeholder minted on accept (direct parent only).
    expect((await db.select({ id: persons.id }).from(persons)).length).toBe(personsBefore);
  });

  it("accept-as-son uses the same shared parent/child nature default as manual place", async () => {
    const { steward, inviteeId, fam } = await inviteAndAccept("son");
    const edges = await edgesOf(fam.id, steward.id);
    const edge = edges.find(
      (e) => e.edgeType === "parent_of" && e.personAId === steward.id && e.personBId === inviteeId,
    );
    expect(edge?.nature).toBe("biological");
  });
});

// Regression (#173): accepting an invite where inviter and invitee resolve to the SAME Person used
// to write a self-edge (insertParentOf/insertPartneredWith with both endpoints equal), tripping the
// kinship_assertions_no_self_ck constraint and rolling back the ENTIRE accept transaction —
// membership insert included — so the invite could never be accepted. The fix: placement no-ops on
// the self-edge (no edge, no sex write) and the accept completes.
describe("regression: self-accept (inviter == invitee) completes with no self-edge (#173)", () => {
  it("the accept completes, no edge is written, and sex is untouched", async () => {
    const { steward, fam } = await familyWithSteward();
    const inviter = await makePerson(db, "Sam Self");
    await addMembership(db, { personId: inviter.id, familyId: fam.id, role: "member" });
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: inviter.id,
      inviteeName: "Sam Self",
      relationship: "son",
    });
    // The re-join edge case from the issue: the inviter's active membership ended, so the accept's
    // membership insert passes and placement runs with inviterPersonId === acceptedPersonId.
    await endMembership(db, account(steward.id), { familyId: fam.id, personId: inviter.id });

    // Before the fix this threw the self-edge check-constraint violation and rolled back.
    await acceptInvitation(db, { token, acceptedPersonId: inviter.id });

    const edges = await edgesOf(fam.id, steward.id);
    expect(edges).toHaveLength(0); // no self-edge written
    expect(await inviteeSex(inviter.id)).toBe("unknown"); // sex write skipped too
  });
});
