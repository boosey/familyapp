/**
 * Tests for the kinship STEWARD-GOVERNANCE write surface (ADR-0016, issue #33): affirmEdge /
 * denyEdge / correctEdge, each an append-only supersede row over an existing logical edge, gated to
 * the family's Steward (server-side role check). Deny removes the edge from the projection but leaves
 * every historical row intact. Correct supersedes the edge's `nature` in place.
 *
 * The load-bearing invariant (a user clarification): the Steward is NOT a visibility gate. An
 * asserted edge is fact immediately; affirm is optional endorsement, deny/correct are after-the-fact
 * moderation. (The subject-hide precedence over affirm is covered in kinship-subject-hide.test.ts.)
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { kinshipAssertions } from "@chronicle/db/kinship";
import { accounts, persons } from "@chronicle/db/schema";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership,
  affirmEdge,
  correctEdge,
  denyEdge,
  listGovernableKinEdges,
  normalizeEdgeEndpoints,
  resolveKinshipProjection,
  type EdgeRef,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string) => ({ kind: "account", personId }) as const;

/** Make a Person that is a real `self` account (origin self + a linked accounts row via accountId). */
async function makeSelfPerson(db: Database, displayName: string) {
  const p = await makePerson(db, displayName);
  const [acct] = await db
    .insert(accounts)
    .values({ authProviderUserId: `auth|${p.id}` })
    .returning();
  await db.update(persons).set({ origin: "self", accountId: acct!.id }).where(eq(persons.id, p.id));
  return p;
}

/** Directly append a `parent_of` assertion transition (bypasses the write API, for arranging state). */
async function assertParentOf(
  db: Database,
  input: {
    familyId: string;
    parent: string;
    child: string;
    actor: string;
    nature?: "biological" | "adoptive" | "step" | "foster" | "unknown";
    state?: "asserted" | "affirmed" | "denied" | "corrected";
  },
) {
  const { personAId, personBId } = normalizeEdgeEndpoints("parent_of", input.parent, input.child);
  await db.insert(kinshipAssertions).values({
    familyId: input.familyId,
    edgeType: "parent_of",
    personAId,
    personBId,
    nature: input.nature ?? "biological",
    state: input.state ?? "asserted",
    actorPersonId: input.actor,
  });
}

/** Count ledger rows for a logical edge (proves history survives a deny/correct). */
async function edgeRowCount(db: Database, ref: EdgeRef): Promise<number> {
  const { personAId, personBId } = normalizeEdgeEndpoints(ref.edgeType, ref.personAId, ref.personBId);
  const rows = await db
    .select({ id: kinshipAssertions.id })
    .from(kinshipAssertions)
    .where(
      and(
        eq(kinshipAssertions.familyId, ref.familyId),
        eq(kinshipAssertions.edgeType, ref.edgeType),
        eq(kinshipAssertions.personAId, personAId),
        eq(kinshipAssertions.personBId, personBId),
      ),
    );
  return rows.length;
}

/** A family whose steward is `steward` and with `member` an active member. Both are real self accounts. */
async function familyWithStewardAndMember() {
  const steward = await makeSelfPerson(db, "Steward");
  const fam = await makeFamily(db, "Esposito", steward.id); // creator == steward (helper sets both)
  await addMembership(db, { personId: steward.id, familyId: fam.id, role: "member" });
  const member = await makeSelfPerson(db, "Member");
  await addMembership(db, { personId: member.id, familyId: fam.id, role: "member" });
  return { steward, member, fam };
}

describe("affirmEdge (#33)", () => {
  it("a steward affirms an existing edge → new append-only `affirmed` row, projection shows affirmed", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: child.id, actor: member.id });

    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: child.id };
    const res = await affirmEdge(db, account(steward.id), ref);
    expect(res.allowed).toBe(true);
    expect(res.edgeId).toBeDefined();
    expect(await edgeRowCount(db, ref)).toBe(2); // original + affirm

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ state: "affirmed", assertedBy: member.id }); // original asserter preserved
  });

  it("rejects a non-steward member (server-side role check), returns {allowed:false}", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: child.id, actor: steward.id });

    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: child.id };
    const res = await affirmEdge(db, account(member.id), ref);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBeDefined();
    expect(await edgeRowCount(db, ref)).toBe(1); // nothing appended
  });

  it("rejects an anonymous viewer", async () => {
    const { fam } = await familyWithStewardAndMember();
    const p = await makePerson(db, "P");
    const c = await makePerson(db, "C");
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: p.id, personBId: c.id };
    const res = await affirmEdge(db, { kind: "anonymous" }, ref);
    expect(res.allowed).toBe(false);
  });

  it("rejects affirming a non-existent edge", async () => {
    const { steward, fam } = await familyWithStewardAndMember();
    const p = await makePerson(db, "P");
    const c = await makePerson(db, "C");
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: p.id, personBId: c.id };
    const res = await affirmEdge(db, account(steward.id), ref);
    expect(res.allowed).toBe(false);
    expect(await edgeRowCount(db, ref)).toBe(0);
  });
});

describe("denyEdge (#33)", () => {
  it("a steward denies an edge → edge gone from projection, history intact (regression)", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: child.id, actor: member.id });

    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: child.id };
    const res = await denyEdge(db, account(steward.id), ref, "wrong person");
    expect(res.allowed).toBe(true);

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(edges).toHaveLength(0); // denied → not shown
    expect(await edgeRowCount(db, ref)).toBe(2); // original assertion NOT mutated; history intact
  });

  it("records the deny `note`", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: child.id, actor: member.id });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: child.id };
    await denyEdge(db, account(steward.id), ref, "not the biological parent");

    const rows = await db
      .select({ state: kinshipAssertions.state, note: kinshipAssertions.note })
      .from(kinshipAssertions)
      .where(eq(kinshipAssertions.state, "denied"));
    expect(rows[0]?.note).toBe("not the biological parent");
  });

  it("allows the original asserter (a non-steward) to deny/retract their own edge (#256)", async () => {
    const { member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: child.id, actor: member.id });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: child.id };
    const res = await denyEdge(db, account(member.id), ref);
    expect(res.allowed).toBe(true);

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(edges).toHaveLength(0); // denied → not shown
    expect(await edgeRowCount(db, ref)).toBe(2); // history intact
  });

  it("rejects a non-steward, non-asserter member", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: child.id, actor: steward.id });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: child.id };
    const res = await denyEdge(db, account(member.id), ref);
    expect(res.allowed).toBe(false);
    expect(await edgeRowCount(db, ref)).toBe(1);
  });
});

describe("denyEdge — asserter retract (#256)", () => {
  it("Alice (non-steward) asserts partnered_with Bob by mistake, then denies it herself → allowed, projection empty, history intact", async () => {
    const { steward, fam } = await familyWithStewardAndMember();
    const alice = await makeSelfPerson(db, "Alice");
    await addMembership(db, { personId: alice.id, familyId: fam.id, role: "member" });
    const bob = await makePerson(db, "Bob");

    const { personAId, personBId } = normalizeEdgeEndpoints("partnered_with", alice.id, bob.id);
    await db.insert(kinshipAssertions).values({
      familyId: fam.id,
      edgeType: "partnered_with",
      personAId,
      personBId,
      nature: null,
      state: "asserted",
      actorPersonId: alice.id,
    });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "partnered_with", personAId: alice.id, personBId: bob.id };

    const res = await denyEdge(db, account(alice.id), ref);
    expect(res.allowed).toBe(true);

    const { edges } = await resolveKinshipProjection(db, account(steward.id), fam.id);
    expect(edges).toHaveLength(0);
    expect(await edgeRowCount(db, ref)).toBe(2);
  });

  it("Charlie — neither steward nor asserter — cannot deny Alice's edge", async () => {
    const { fam } = await familyWithStewardAndMember();
    const alice = await makeSelfPerson(db, "Alice");
    await addMembership(db, { personId: alice.id, familyId: fam.id, role: "member" });
    const bob = await makePerson(db, "Bob");
    const charlie = await makeSelfPerson(db, "Charlie");
    await addMembership(db, { personId: charlie.id, familyId: fam.id, role: "member" });

    const { personAId, personBId } = normalizeEdgeEndpoints("partnered_with", alice.id, bob.id);
    await db.insert(kinshipAssertions).values({
      familyId: fam.id,
      edgeType: "partnered_with",
      personAId,
      personBId,
      nature: null,
      state: "asserted",
      actorPersonId: alice.id,
    });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "partnered_with", personAId: alice.id, personBId: bob.id };

    const res = await denyEdge(db, account(charlie.id), ref);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBeDefined();
    expect(await edgeRowCount(db, ref)).toBe(1);
  });

  it("the steward can still deny an edge they did not assert (regression)", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: child.id, actor: member.id });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: child.id };

    const res = await denyEdge(db, account(steward.id), ref);
    expect(res.allowed).toBe(true);
    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(edges).toHaveLength(0);
  });

  it("the asserter cannot affirmEdge (still steward-only)", async () => {
    const { fam } = await familyWithStewardAndMember();
    const alice = await makeSelfPerson(db, "Alice");
    await addMembership(db, { personId: alice.id, familyId: fam.id, role: "member" });
    const bob = await makePerson(db, "Bob");
    await assertParentOf(db, { familyId: fam.id, parent: alice.id, child: bob.id, actor: alice.id });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: alice.id, personBId: bob.id };

    const res = await affirmEdge(db, account(alice.id), ref);
    expect(res.allowed).toBe(false);
  });

  it("the asserter cannot correctEdge (still steward-only)", async () => {
    const { fam } = await familyWithStewardAndMember();
    const alice = await makeSelfPerson(db, "Alice");
    await addMembership(db, { personId: alice.id, familyId: fam.id, role: "member" });
    const bob = await makePerson(db, "Bob");
    await assertParentOf(db, { familyId: fam.id, parent: alice.id, child: bob.id, actor: alice.id });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: alice.id, personBId: bob.id };

    const res = await correctEdge(db, account(alice.id), { ref, nature: "adoptive" });
    expect(res.allowed).toBe(false);
  });

  it("listGovernableKinEdges: viewerCanRemove is true for the asserter (non-steward), false for a stranger, true for the steward", async () => {
    const { steward, fam } = await familyWithStewardAndMember();
    const alice = await makeSelfPerson(db, "Alice");
    await addMembership(db, { personId: alice.id, familyId: fam.id, role: "member" });
    const bob = await makePerson(db, "Bob");
    const charlie = await makeSelfPerson(db, "Charlie");
    await addMembership(db, { personId: charlie.id, familyId: fam.id, role: "member" });

    const { personAId, personBId } = normalizeEdgeEndpoints("partnered_with", alice.id, bob.id);
    await db.insert(kinshipAssertions).values({
      familyId: fam.id,
      edgeType: "partnered_with",
      personAId,
      personBId,
      nature: null,
      state: "asserted",
      actorPersonId: alice.id,
    });

    const asAlice = await listGovernableKinEdges(db, account(alice.id), fam.id);
    expect(asAlice[0]!.viewerCanRemove).toBe(true);
    expect(asAlice[0]!.viewerIsSteward).toBe(false);
    expect(asAlice[0]!.assertedBy).toBe(alice.id);

    const asCharlie = await listGovernableKinEdges(db, account(charlie.id), fam.id);
    expect(asCharlie[0]!.viewerCanRemove).toBe(false);

    const asSteward = await listGovernableKinEdges(db, account(steward.id), fam.id);
    expect(asSteward[0]!.viewerCanRemove).toBe(true);
    expect(asSteward[0]!.viewerIsSteward).toBe(true);
  });
});

describe("correctEdge (#33)", () => {
  it("a steward corrects a parent_of edge's nature → superseding `corrected` row, projection updates nature", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    await assertParentOf(db, {
      familyId: fam.id,
      parent: parent.id,
      child: child.id,
      actor: member.id,
      nature: "biological",
    });

    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: child.id };
    const res = await correctEdge(db, account(steward.id), { ref, nature: "adoptive", note: "was adopted" });
    expect(res.allowed).toBe(true);

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ state: "corrected", nature: "adoptive", assertedBy: member.id });
    expect(await edgeRowCount(db, ref)).toBe(2);
  });

  it("rejects correcting a partnered_with edge's nature (nature is parent_of-only)", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    const x = await makePerson(db, "X");
    const { personAId, personBId } = normalizeEdgeEndpoints("partnered_with", steward.id, x.id);
    await db.insert(kinshipAssertions).values({
      familyId: fam.id,
      edgeType: "partnered_with",
      personAId,
      personBId,
      nature: null,
      state: "asserted",
      actorPersonId: member.id,
    });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "partnered_with", personAId: steward.id, personBId: x.id };
    const res = await correctEdge(db, account(steward.id), { ref, nature: "step" });
    expect(res.allowed).toBe(false);
  });

  it("rejects a non-steward", async () => {
    const { member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    await assertParentOf(db, { familyId: fam.id, parent: parent.id, child: child.id, actor: member.id });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: child.id };
    const res = await correctEdge(db, account(member.id), { ref, nature: "step" });
    expect(res.allowed).toBe(false);
  });

  it("rejects correcting a non-existent edge", async () => {
    const { steward, fam } = await familyWithStewardAndMember();
    const p = await makePerson(db, "P");
    const c = await makePerson(db, "C");
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: p.id, personBId: c.id };
    const res = await correctEdge(db, account(steward.id), { ref, nature: "step" });
    expect(res.allowed).toBe(false);
  });

  it("correct then affirm PRESERVES the corrected nature (regression: affirm must not clobber it)", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    await assertParentOf(db, {
      familyId: fam.id,
      parent: parent.id,
      child: child.id,
      actor: member.id,
      nature: "biological",
    });
    const ref: EdgeRef = { familyId: fam.id, edgeType: "parent_of", personAId: parent.id, personBId: child.id };

    // Steward corrects nature to adoptive, then LATER affirms (optional endorsement).
    await correctEdge(db, account(steward.id), { ref, nature: "adoptive" });
    await affirmEdge(db, account(steward.id), ref);

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(edges).toHaveLength(1);
    // The affirm must carry the corrected nature forward — NOT reset it to "unknown".
    expect(edges[0]).toMatchObject({ state: "affirmed", nature: "adoptive" });
  });
});

describe("listGovernableKinEdges (read composition for the governance UI)", () => {
  it("flags viewerIsSteward for the steward and clears it for a member", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    // member (a self endpoint) is the child of steward → one visible edge involving both.
    await assertParentOf(db, { familyId: fam.id, parent: steward.id, child: member.id, actor: steward.id });

    const asSteward = await listGovernableKinEdges(db, account(steward.id), fam.id);
    expect(asSteward).toHaveLength(1);
    expect(asSteward[0]!.viewerIsSteward).toBe(true);

    const asMember = await listGovernableKinEdges(db, account(member.id), fam.id);
    expect(asMember[0]!.viewerIsSteward).toBe(false);
  });

  it("flags viewerCanHide only when the viewer is a self-account endpoint of the edge", async () => {
    const { steward, member, fam } = await familyWithStewardAndMember();
    // member is an endpoint (child) and a self account → can hide.
    await assertParentOf(db, { familyId: fam.id, parent: steward.id, child: member.id, actor: steward.id });

    const asMember = await listGovernableKinEdges(db, account(member.id), fam.id);
    expect(asMember[0]!.viewerCanHide).toBe(true);

    // A third self member who is NOT an endpoint cannot hide this edge.
    const other = await makeSelfPerson(db, "Other");
    await addMembership(db, { personId: other.id, familyId: fam.id, role: "member" });
    const asOther = await listGovernableKinEdges(db, account(other.id), fam.id);
    expect(asOther[0]!.viewerCanHide).toBe(false);
  });
});
