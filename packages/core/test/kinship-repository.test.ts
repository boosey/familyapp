/**
 * Tests for the kinship read surface (ADR-0016, issue #31): family-membership auth, latest-supersede
 * resolution, first-asserter-wins, the subject-hide veto overlay, per-family scoping, and the
 * derived-relation walk (sibling = shares-a-parent, cousin = parents-are-siblings).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { kinshipAssertions, kinshipSubjectHides } from "@chronicle/db/kinship";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  addMembership,
  addRelative,
  deriveKin,
  listMyKin,
  normalizeEdgeEndpoints,
  resolveKinshipProjection,
  type KinRelation,
  type ResolvedKinshipEdge,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string) => ({ kind: "account", personId }) as const;

/** Insert a kinship assertion transition. seq (bigserial) auto-increments, so call-order = supersede
 *  order — later calls win. parent_of keeps direction (parent, child); partnered_with is normalized. */
async function assert(
  db: Database,
  input: {
    familyId: string;
    edgeType: "parent_of" | "partnered_with";
    a: string;
    b: string;
    actor: string;
    nature?: "biological" | "adoptive" | "step" | "foster" | "unknown";
    state?: "asserted" | "affirmed" | "denied" | "corrected";
  },
) {
  const { personAId, personBId } = normalizeEdgeEndpoints(input.edgeType, input.a, input.b);
  await db.insert(kinshipAssertions).values({
    familyId: input.familyId,
    edgeType: input.edgeType,
    personAId,
    personBId,
    nature: input.edgeType === "parent_of" ? (input.nature ?? "biological") : null,
    state: input.state ?? "asserted",
    actorPersonId: input.actor,
  });
}

async function hide(
  db: Database,
  input: {
    familyId: string;
    edgeType: "parent_of" | "partnered_with";
    a: string;
    b: string;
    subject: string;
    hidden: boolean;
  },
) {
  const { personAId, personBId } = normalizeEdgeEndpoints(input.edgeType, input.a, input.b);
  await db.insert(kinshipSubjectHides).values({
    familyId: input.familyId,
    edgeType: input.edgeType,
    personAId,
    personBId,
    subjectPersonId: input.subject,
    hidden: input.hidden,
    actorPersonId: input.subject,
  });
}

/** A family with `member` as an active member (so they may read its tree). */
async function familyWithMember(memberName = "Reader") {
  const member = await makePerson(db, memberName);
  const fam = await makeFamily(db, "Esposito", member.id);
  await addMembership(db, { personId: member.id, familyId: fam.id, role: "member" });
  return { member, fam };
}

function relationOf(edges: ResolvedKinshipEdge[], root: string, target: string): KinRelation | undefined {
  return deriveKin(edges, root).find((k) => k.personId === target)?.relation;
}

describe("resolveKinshipProjection — authorization", () => {
  it("rejects a viewer who is not an active member of the family", async () => {
    const { fam } = await familyWithMember();
    const stranger = await makePerson(db, "Stranger");
    await expect(
      resolveKinshipProjection(db, account(stranger.id), fam.id),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects an anonymous viewer", async () => {
    const { fam } = await familyWithMember();
    await expect(
      resolveKinshipProjection(db, { kind: "anonymous" }, fam.id),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("resolveKinshipProjection — resolution", () => {
  it("first-asserter-wins: a bare `asserted` edge is visible, assertedBy = original actor", async () => {
    const { member, fam } = await familyWithMember();
    const parent = await makePerson(db, "Nonna");
    const child = await makePerson(db, "Child");
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: parent.id, b: child.id, actor: member.id });

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      edgeType: "parent_of",
      personAId: parent.id,
      personBId: child.id,
      state: "asserted",
      assertedBy: member.id,
    });
  });

  it("latest-supersede: a later `denied` hides the edge; a later `corrected` restores + updates nature", async () => {
    const { member, fam } = await familyWithMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    const steward = await makePerson(db, "Steward");

    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: parent.id, b: child.id, actor: member.id, nature: "biological" });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: parent.id, b: child.id, actor: steward.id, state: "denied" });

    let proj = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(proj.edges).toHaveLength(0); // denied is the latest → hidden

    // Steward corrects: a new superseding row with corrected nature. Latest wins → visible again.
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: parent.id, b: child.id, actor: steward.id, state: "corrected", nature: "adoptive" });
    proj = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(proj.edges).toHaveLength(1);
    expect(proj.edges[0]).toMatchObject({ state: "corrected", nature: "adoptive", assertedBy: member.id });
  });

  it("subject-hide overrides an affirmed edge; a later un-hide restores it", async () => {
    const { member, fam } = await familyWithMember();
    const parent = await makePerson(db, "P");
    const child = await makePerson(db, "C");
    const steward = await makePerson(db, "Steward");

    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: parent.id, b: child.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: parent.id, b: child.id, actor: steward.id, state: "affirmed" });
    // The child (subject) hides it — even though the Steward affirmed.
    await hide(db, { familyId: fam.id, edgeType: "parent_of", a: parent.id, b: child.id, subject: child.id, hidden: true });

    let proj = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(proj.edges).toHaveLength(0);

    await hide(db, { familyId: fam.id, edgeType: "parent_of", a: parent.id, b: child.id, subject: child.id, hidden: false });
    proj = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(proj.edges).toHaveLength(1);
  });

  it("partnered_with is undirected: (A,B) and (B,A) are one edge", async () => {
    const { member, fam } = await familyWithMember();
    const x = await makePerson(db, "X");
    const y = await makePerson(db, "Y");
    // Assert once each way — must collapse to a single logical edge.
    await assert(db, { familyId: fam.id, edgeType: "partnered_with", a: x.id, b: y.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "partnered_with", a: y.id, b: x.id, actor: member.id });

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.nature).toBeNull();
  });

  it("parent_of is directed: (A,B) and (B,A) are two independent, coexisting edges", async () => {
    const { member, fam } = await familyWithMember();
    const x = await makePerson(db, "X");
    const y = await makePerson(db, "Y");
    // "X is parent of Y" and "Y is parent of X" are contradictory but DISTINCT facts (a data error a
    // Steward would resolve) — they must NOT collapse into one edge the way partnered_with does.
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: x.id, b: y.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: y.id, b: x.id, actor: member.id });

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(edges).toHaveLength(2); // NOT collapsed — two distinct directed edges
    const hasXtoY = edges.some((e) => e.personAId === x.id && e.personBId === y.id);
    const hasYtoX = edges.some((e) => e.personAId === y.id && e.personBId === x.id);
    expect(hasXtoY).toBe(true);
    expect(hasYtoX).toBe(true);
  });

  it("ignores a hide whose subject is not an endpoint of the edge (defensive)", async () => {
    const { member, fam } = await familyWithMember();
    const p = await makePerson(db, "P");
    const c = await makePerson(db, "C");
    const stranger = await makePerson(db, "Stranger");
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: p.id, b: c.id, actor: member.id });
    // A malformed hide by someone who is neither endpoint must NOT suppress the edge.
    await hide(db, { familyId: fam.id, edgeType: "parent_of", a: p.id, b: c.id, subject: stranger.id, hidden: true });

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(edges).toHaveLength(1);
  });

  it("is family-scoped: an edge surfaced into another family is not returned", async () => {
    const { member, fam } = await familyWithMember();
    const otherFam = await makeFamily(db, "Other", member.id);
    await addMembership(db, { personId: member.id, familyId: otherFam.id, role: "member" });
    const p = await makePerson(db, "P");
    const c = await makePerson(db, "C");
    await assert(db, { familyId: otherFam.id, edgeType: "parent_of", a: p.id, b: c.id, actor: member.id });

    const proj = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(proj.edges).toHaveLength(0); // asserted into otherFam, not fam
  });
});

describe("deriveKin — derived relations", () => {
  it("derives sibling (shares-a-parent) and cousin (parents-are-siblings)", async () => {
    const { member, fam } = await familyWithMember();
    const gp = await makePerson(db, "Grandparent");
    const pa = await makePerson(db, "Parent");
    const au = await makePerson(db, "AuntUncle");
    const root = await makePerson(db, "Root");
    const sib = await makePerson(db, "Sibling");
    const cousin = await makePerson(db, "Cousin");

    // GP is parent of PA and AU (=> PA, AU are siblings).
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: gp.id, b: pa.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: gp.id, b: au.id, actor: member.id });
    // PA is parent of Root and Sibling (=> Root, Sibling share a parent).
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: pa.id, b: root.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: pa.id, b: sib.id, actor: member.id });
    // AU is parent of Cousin (=> Cousin's parent AU is a sibling of Root's parent PA).
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: au.id, b: cousin.id, actor: member.id });

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);

    expect(relationOf(edges, root.id, pa.id)).toBe("parent");
    expect(relationOf(edges, root.id, gp.id)).toBe("grandparent");
    expect(relationOf(edges, root.id, sib.id)).toBe("sibling");
    expect(relationOf(edges, root.id, au.id)).toBe("aunt_uncle");
    expect(relationOf(edges, root.id, cousin.id)).toBe("cousin");
    // Root is not its own kin.
    expect(deriveKin(edges, root.id).some((k) => k.personId === root.id)).toBe(false);
  });

  it("derives child, grandchild, and partner", async () => {
    const { member, fam } = await familyWithMember();
    const root = await makePerson(db, "Root");
    const child = await makePerson(db, "Child");
    const grandchild = await makePerson(db, "Grandchild");
    const partner = await makePerson(db, "Partner");

    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: root.id, b: child.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: child.id, b: grandchild.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "partnered_with", a: root.id, b: partner.id, actor: member.id });

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(relationOf(edges, root.id, child.id)).toBe("child");
    expect(relationOf(edges, root.id, grandchild.id)).toBe("grandchild");
    expect(relationOf(edges, root.id, partner.id)).toBe("partner");
  });

  it("a denied/hidden edge does not feed derivation", async () => {
    const { member, fam } = await familyWithMember();
    const pa = await makePerson(db, "Parent");
    const root = await makePerson(db, "Root");
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: pa.id, b: root.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: pa.id, b: root.id, actor: member.id, state: "denied" });

    const { edges } = await resolveKinshipProjection(db, account(member.id), fam.id);
    expect(relationOf(edges, root.id, pa.id)).toBeUndefined();
  });
});

describe("listMyKin — read composition", () => {
  it("returns an identified relative with its displayName", async () => {
    const { member, fam } = await familyWithMember("Me");
    const res = await addRelative(db, account(member.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Eleanor Vance",
      lifeStatus: "deceased",
    });

    const kin = await listMyKin(db, account(member.id), fam.id);
    const entry = kin.find((k) => k.personId === res.createdPersonId);
    expect(entry).toMatchObject({
      relation: "parent",
      displayName: "Eleanor Vance",
      identified: true,
      lifeStatus: "deceased",
    });
  });

  it("returns an unidentified placeholder relative with displayName null / identified false", async () => {
    const { member, fam } = await familyWithMember("Me");
    // A grandparent added from a parentless me mints an anonymous bridge PARENT — which shows up in
    // my kin list as a `parent` placeholder (displayName null).
    await addRelative(db, account(member.id), {
      familyId: fam.id,
      relation: "grandparent",
      displayName: "Grandma Eleanor",
    });

    const kin = await listMyKin(db, account(member.id), fam.id);
    const placeholder = kin.find((k) => k.relation === "parent");
    expect(placeholder).toBeDefined();
    expect(placeholder!.displayName).toBeNull();
    expect(placeholder!.identified).toBe(false);
    // And the named grandparent is present + identified.
    const gp = kin.find((k) => k.relation === "grandparent");
    expect(gp?.displayName).toBe("Grandma Eleanor");
    expect(gp?.identified).toBe(true);
  });

  it("rejects a non-member (auth flows through resolveKinshipProjection)", async () => {
    const { fam } = await familyWithMember("Me");
    const stranger = await makePerson(db, "Stranger");
    await expect(listMyKin(db, account(stranger.id), fam.id)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});

describe("kinship ledgers are append-only (invariants.sql)", () => {
  it("forbids UPDATE and DELETE on kinship_assertions", async () => {
    const { member, fam } = await familyWithMember();
    const p = await makePerson(db, "P");
    const c = await makePerson(db, "C");
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: p.id, b: c.id, actor: member.id });

    await expect(
      db.update(kinshipAssertions).set({ state: "affirmed" }),
    ).rejects.toThrow(/append-only|not permitted/i);
    await expect(db.delete(kinshipAssertions)).rejects.toThrow(/append-only|not permitted/i);
  });
});
