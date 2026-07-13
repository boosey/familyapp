/**
 * Tests for the kinship WRITE surface (ADR-0016, issue #32): `addRelative`.
 *
 * Covers the five v1 relations (parent, child, partner, grandparent, sibling), the anonymous
 * bridge-node creation + reuse logic, first-asserter-wins family-wide visibility, and the
 * server-side auth + active-membership re-resolution. All fixtures use PGlite (real Postgres).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { kinshipAssertions } from "@chronicle/db/kinship";
import { persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMembership,
  addRelative,
  deriveKin,
  resolveKinshipProjection,
  type AuthContext,
  type KinRelation,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string): AuthContext => ({ kind: "account", personId });

/** A family with `me` as an active member — the caller who adds relatives to it. */
async function familyWithMe(name = "Me") {
  const me = await makePerson(db, name);
  const fam = await makeFamily(db, "Esposito", me.id);
  await addMembership(db, { personId: me.id, familyId: fam.id, role: "member" });
  return { me, fam };
}

async function personRow(id: string) {
  const [row] = await db
    .select({
      displayName: persons.displayName,
      spokenName: persons.spokenName,
      origin: persons.origin,
      identified: persons.identified,
      lifeStatus: persons.lifeStatus,
      birthDate: persons.birthDate,
      birthYear: persons.birthYear,
      sex: persons.sex,
    })
    .from(persons)
    .where(eq(persons.id, id))
    .limit(1);
  return row!;
}

async function relationOf(fam: string, root: string, target: string): Promise<KinRelation | undefined> {
  const { edges } = await resolveKinshipProjection(db, account(root), fam);
  return deriveKin(edges, root).find((k) => k.personId === target)?.relation;
}

/**
 * A family with two active `self` members — `me` (the viewer/actor) and `other`. Used to exercise
 * the optional `anchorPersonId` on `addRelative`: anchoring a relative on `other` records a
 * relationship that isn't about the actor, without granting the actor any new authority.
 */
async function seedTwoMemberFamily() {
  const me = await makePerson(db, "Me");
  const other = await makePerson(db, "Other");
  const fam = await makeFamily(db, "Esposito", me.id);
  await addMembership(db, { personId: me.id, familyId: fam.id, role: "member" });
  await addMembership(db, { personId: other.id, familyId: fam.id, role: "member" });
  return {
    db,
    ctx: account(me.id),
    familyId: fam.id,
    mePersonId: me.id,
    otherPersonId: other.id,
  };
}

describe("addRelative — auth", () => {
  it("denies an anonymous caller", async () => {
    const { fam } = await familyWithMe();
    const res = await addRelative(db, { kind: "anonymous" }, {
      familyId: fam.id,
      relation: "parent",
      displayName: "Nonna",
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/not signed in/i);
  });

  it("denies a non-member of the family", async () => {
    const { fam } = await familyWithMe();
    const stranger = await makePerson(db, "Stranger");
    const res = await addRelative(db, account(stranger.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Nonna",
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/not a member/i);
    // No edges written.
    const rows = await db.select().from(kinshipAssertions);
    expect(rows).toHaveLength(0);
  });
});

describe("addRelative — direct relations", () => {
  it("adds an identified parent → deriveKin(me) labels it `parent`", async () => {
    const { me, fam } = await familyWithMe();
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Eleanor Vance",
      lifeStatus: "deceased",
      birthYear: 1940,
    });
    expect(res.allowed).toBe(true);
    expect(res.bridgePersonId).toBeUndefined();
    expect(res.edgeIds).toHaveLength(1);

    const r = await personRow(res.createdPersonId!);
    expect(r.origin).toBe("mention");
    expect(r.identified).toBe(true);
    expect(r.displayName).toBe("Eleanor Vance");
    expect(r.spokenName).toBe("Eleanor"); // first whitespace-delimited word
    expect(r.lifeStatus).toBe("deceased");
    expect(r.birthYear).toBe(1940);

    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("parent");
  });

  it("adds a child → labeled `child`", async () => {
    const { me, fam } = await familyWithMe();
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "child",
      displayName: "Sam",
    });
    expect(res.allowed).toBe(true);
    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("child");
  });

  it("adds a partner → labeled `partner`, edge nature null", async () => {
    const { me, fam } = await familyWithMe();
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "partner",
      displayName: "Rae",
    });
    expect(res.allowed).toBe(true);
    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("partner");

    const [edge] = await db
      .select()
      .from(kinshipAssertions)
      .where(eq(kinshipAssertions.edgeType, "partnered_with"));
    expect(edge!.nature).toBeNull();
  });

  it("stores parent_of nature from input.nature, defaulting to `unknown`", async () => {
    const { me, fam } = await familyWithMe();
    await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "child",
      displayName: "Adopted",
      nature: "adoptive",
    });
    await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "child",
      displayName: "Default",
    });
    const rows = await db
      .select({ nature: kinshipAssertions.nature })
      .from(kinshipAssertions)
      .where(eq(kinshipAssertions.edgeType, "parent_of"));
    const natures = rows.map((r) => r.nature).sort();
    expect(natures).toEqual(["adoptive", "unknown"]);
  });

  it("creates an anonymous bridge relative when displayName is empty/whitespace", async () => {
    const { me, fam } = await familyWithMe();
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "   ",
    });
    const r = await personRow(res.createdPersonId!);
    expect(r.identified).toBe(false);
    expect(r.displayName).toBeNull();
    expect(r.spokenName).toBeNull();
  });

  it("persists a supplied sex on the created relative", async () => {
    const { me, fam } = await familyWithMe();
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Eleanor Vance",
      sex: "female",
    });
    const r = await personRow(res.createdPersonId!);
    expect(r.sex).toBe("female");
  });

  it("defaults the created relative's sex to `unknown` when omitted", async () => {
    const { me, fam } = await familyWithMe();
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Eleanor Vance",
    });
    const r = await personRow(res.createdPersonId!);
    expect(r.sex).toBe("unknown");
  });

  it("keeps an auto-minted bridge person's sex `unknown` even when the relative's sex is supplied", async () => {
    const { me, fam } = await familyWithMe();
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "grandparent",
      displayName: "Grandma Eleanor",
      sex: "female",
    });
    expect(res.bridgePersonId).toBeDefined();
    const bridge = await personRow(res.bridgePersonId!);
    expect(bridge.sex).toBe("unknown");
    const created = await personRow(res.createdPersonId!);
    expect(created.sex).toBe("female");
  });
});

describe("addRelative — grandparent (bridge + reuse)", () => {
  it("from a parentless me: creates a bridge (identified=false) + two parent_of edges, labels `grandparent`", async () => {
    const { me, fam } = await familyWithMe();
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "grandparent",
      displayName: "Grandma Eleanor",
    });
    expect(res.allowed).toBe(true);
    expect(res.bridgePersonId).toBeDefined();
    expect(res.edgeIds).toHaveLength(2);

    // Bridge is an anonymous placeholder mention.
    const bridge = await personRow(res.bridgePersonId!);
    expect(bridge.origin).toBe("mention");
    expect(bridge.identified).toBe(false);
    expect(bridge.displayName).toBeNull();

    // Two parent_of edges: bridge->me and grandparent->bridge.
    const edges = await db
      .select()
      .from(kinshipAssertions)
      .where(eq(kinshipAssertions.edgeType, "parent_of"));
    expect(edges).toHaveLength(2);
    const bridgeParentOfMe = edges.some(
      (e) => e.personAId === res.bridgePersonId && e.personBId === me.id,
    );
    const gpParentOfBridge = edges.some(
      (e) => e.personAId === res.createdPersonId && e.personBId === res.bridgePersonId,
    );
    expect(bridgeParentOfMe).toBe(true);
    expect(gpParentOfBridge).toBe(true);

    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("grandparent");
  });

  it("reuses an existing parent (no new bridge) — attaches grandparent above each parent", async () => {
    const { me, fam } = await familyWithMe();
    // First give me a real parent.
    const parentRes = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Mom",
    });
    const parentId = parentRes.createdPersonId!;

    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "grandparent",
      displayName: "Grandma Eleanor",
    });
    expect(res.allowed).toBe(true);
    expect(res.bridgePersonId).toBeUndefined(); // reused the existing parent
    expect(res.edgeIds).toHaveLength(1); // grandparent -> existing parent

    const [edge] = await db
      .select()
      .from(kinshipAssertions)
      .where(eq(kinshipAssertions.id, res.edgeIds![0]!));
    expect(edge!.personAId).toBe(res.createdPersonId);
    expect(edge!.personBId).toBe(parentId);

    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("grandparent");
  });
});

describe("addRelative — sibling (bridge + reuse)", () => {
  it("from a parentless me: creates a bridge parent + two parent_of edges, labels `sibling`", async () => {
    const { me, fam } = await familyWithMe();
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "sibling",
      displayName: "Bro",
    });
    expect(res.allowed).toBe(true);
    expect(res.bridgePersonId).toBeDefined();
    expect(res.edgeIds).toHaveLength(2);

    const bridge = await personRow(res.bridgePersonId!);
    expect(bridge.identified).toBe(false);

    // bridge -> me and bridge -> sibling.
    const edges = await db
      .select()
      .from(kinshipAssertions)
      .where(eq(kinshipAssertions.edgeType, "parent_of"));
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.personAId === res.bridgePersonId)).toBe(true);
    const childIds = edges.map((e) => e.personBId).sort();
    expect(childIds).toEqual([me.id, res.createdPersonId!].sort());

    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("sibling");
  });

  it("reuses an existing parent (no new bridge) — attaches sibling below each parent", async () => {
    const { me, fam } = await familyWithMe();
    const parentRes = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Mom",
    });
    const parentId = parentRes.createdPersonId!;

    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "sibling",
      displayName: "Sis",
    });
    expect(res.allowed).toBe(true);
    expect(res.bridgePersonId).toBeUndefined();
    expect(res.edgeIds).toHaveLength(1); // existing parent -> sibling

    const [edge] = await db
      .select()
      .from(kinshipAssertions)
      .where(eq(kinshipAssertions.id, res.edgeIds![0]!));
    expect(edge!.personAId).toBe(parentId);
    expect(edge!.personBId).toBe(res.createdPersonId);

    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("sibling");
  });
});

describe("addRelative — visibility & audit", () => {
  it("is family-wide visible: a second active member sees the edge (first-asserter-wins)", async () => {
    const { me, fam } = await familyWithMe();
    const other = await makePerson(db, "Cousin");
    await addMembership(db, { personId: other.id, familyId: fam.id, role: "member" });

    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Nonna",
    });

    const { edges } = await resolveKinshipProjection(db, account(other.id), fam.id);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      edgeType: "parent_of",
      personAId: res.createdPersonId,
      personBId: me.id,
      state: "asserted",
      assertedBy: me.id, // the actor of the edge
    });
  });
});

describe("addRelative — optional coParentPersonId (relation=child only)", () => {
  it("relation=child with a valid coParentPersonId creates BOTH parent_of edges", async () => {
    const { db, ctx, familyId, mePersonId, otherPersonId } = await seedTwoMemberFamily();
    const res = await addRelative(db, ctx, {
      familyId,
      relation: "child",
      displayName: "Kid",
      coParentPersonId: otherPersonId,
    });
    expect(res.allowed).toBe(true);
    expect(res.edgeIds).toHaveLength(2);

    const proj = await resolveKinshipProjection(db, ctx, familyId);
    const parentsOfChild = proj.edges
      .filter((e) => e.edgeType === "parent_of" && e.personBId === res.createdPersonId)
      .map((e) => e.personAId)
      .sort();
    expect(parentsOfChild).toEqual([mePersonId, otherPersonId].sort());
  });

  it("relation=child WITHOUT coParentPersonId creates only the single parent edge (unchanged)", async () => {
    const { db, ctx, familyId, mePersonId } = await seedTwoMemberFamily();
    const res = await addRelative(db, ctx, {
      familyId,
      relation: "child",
      displayName: "Kid",
    });
    expect(res.allowed).toBe(true);
    expect(res.edgeIds).toHaveLength(1);

    const proj = await resolveKinshipProjection(db, ctx, familyId);
    const parentsOfChild = proj.edges
      .filter((e) => e.edgeType === "parent_of" && e.personBId === res.createdPersonId)
      .map((e) => e.personAId);
    expect(parentsOfChild).toEqual([mePersonId]);
  });

  it("rejects a coParentPersonId that is not attachable in this family", async () => {
    const { db, ctx, familyId } = await seedTwoMemberFamily();
    const outsider = await makePerson(db, "Outsider");
    const res = await addRelative(db, ctx, {
      familyId,
      relation: "child",
      displayName: "Kid",
      coParentPersonId: outsider.id,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/co-?parent/i);

    // Nothing written — no partial child creation on a rejected co-parent.
    const rows = await db.select().from(kinshipAssertions);
    expect(rows).toHaveLength(0);
  });

  it("ignores coParentPersonId on a non-child relation", async () => {
    const { db, ctx, familyId, otherPersonId } = await seedTwoMemberFamily();
    const res = await addRelative(db, ctx, {
      familyId,
      relation: "parent",
      displayName: "Grandpa",
      coParentPersonId: otherPersonId,
    });
    expect(res.allowed).toBe(true);
    expect(res.edgeIds).toHaveLength(1);
  });
});

describe("addRelative — optional anchorPersonId", () => {
  it("anchors a parent on the given anchorPersonId, not the viewer", async () => {
    const { db, ctx, familyId, otherPersonId } = await seedTwoMemberFamily();
    const res = await addRelative(db, ctx, {
      familyId,
      relation: "parent",
      displayName: "Grandpa",
      anchorPersonId: otherPersonId,
    });
    expect(res.allowed).toBe(true);
    const proj = await resolveKinshipProjection(db, ctx, familyId);
    const edge = proj.edges.find(
      (e) =>
        e.edgeType === "parent_of" &&
        e.personBId === otherPersonId &&
        e.personAId === res.createdPersonId,
    );
    expect(edge).toBeDefined();
  });

  it("defaults the anchor to the viewer when anchorPersonId is omitted", async () => {
    const { db, ctx, familyId, mePersonId } = await seedTwoMemberFamily();
    const res = await addRelative(db, ctx, { familyId, relation: "child", displayName: "Kid" });
    const proj = await resolveKinshipProjection(db, ctx, familyId);
    const edge = proj.edges.find(
      (e) =>
        e.edgeType === "parent_of" &&
        e.personAId === mePersonId &&
        e.personBId === res.createdPersonId,
    );
    expect(edge).toBeDefined();
  });

  it("a sibling anchored on X shares X's parent", async () => {
    const { db, ctx, familyId, otherPersonId } = await seedTwoMemberFamily();
    await addRelative(db, ctx, {
      familyId,
      relation: "parent",
      displayName: "P",
      anchorPersonId: otherPersonId,
    });
    const sib = await addRelative(db, ctx, {
      familyId,
      relation: "sibling",
      displayName: "S",
      anchorPersonId: otherPersonId,
    });
    const proj = await resolveKinshipProjection(db, ctx, familyId);
    const parentsOfOther = proj.edges
      .filter((e) => e.edgeType === "parent_of" && e.personBId === otherPersonId)
      .map((e) => e.personAId);
    const parentsOfSib = proj.edges
      .filter((e) => e.edgeType === "parent_of" && e.personBId === sib.createdPersonId)
      .map((e) => e.personAId);
    expect(parentsOfSib.some((p) => parentsOfOther.includes(p))).toBe(true);
  });

  it("rejects an anchor that is not visible in this family's projection", async () => {
    const { db, ctx, familyId } = await seedTwoMemberFamily();
    // A person that exists but has no edge in this family's projection is not a valid anchor.
    const outsider = await makePerson(db, "Outsider");
    const res = await addRelative(db, ctx, {
      familyId,
      relation: "parent",
      displayName: "Nope",
      anchorPersonId: outsider.id,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/anchor/i);
  });

  it("rejects an anchor who is only an active member of a DIFFERENT family (no cross-family leak)", async () => {
    const { db, ctx, familyId } = await seedTwoMemberFamily();
    // A real person who is an ACTIVE member — but of some OTHER family, not this one.
    const outsider = await makePerson(db, "OtherFamMember");
    const otherFam = await makeFamily(db, "Rossi", outsider.id);
    await addMembership(db, { personId: outsider.id, familyId: otherFam.id, role: "member" });

    const res = await addRelative(db, ctx, {
      familyId,
      relation: "parent",
      displayName: "Nope",
      anchorPersonId: outsider.id,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/anchor person is not in this family/i);

    // And nothing about the other family leaked in: no edge references the outsider here.
    const proj = await resolveKinshipProjection(db, ctx, familyId);
    const touchesOutsider = proj.edges.some(
      (e) => e.personAId === outsider.id || e.personBId === outsider.id,
    );
    expect(touchesOutsider).toBe(false);
  });
});
