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
  linkExistingMember,
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

/** The (deduped) set of recorded parent person-ids of `child` in `fam`, as the viewer `root` sees it. */
async function parentIdsOf(fam: string, root: string, child: string): Promise<string[]> {
  const { edges } = await resolveKinshipProjection(db, account(root), fam);
  const set = new Set<string>();
  for (const e of edges) {
    if (e.edgeType === "parent_of" && e.personBId === child) set.add(e.personAId);
  }
  return [...set];
}

/** Are `a` and `b` a FULL sibling pair (they share the SAME two parents, exactly)? */
async function shareBothParents(fam: string, root: string, a: string, b: string): Promise<boolean> {
  const pa = (await parentIdsOf(fam, root, a)).sort();
  const pb = (await parentIdsOf(fam, root, b)).sort();
  return pa.length === 2 && pb.length === 2 && pa[0] === pb[0] && pa[1] === pb[1];
}

describe("addRelative — sibling (ADR-0017: shares a full parent-couple)", () => {
  // Case 1: parentless anchor → TWO placeholders (partnered), both parents of both siblings.
  it("from a parentless anchor: mints TWO placeholder parents (identified=false), partnered, both parents of both siblings", async () => {
    const { me, fam } = await familyWithMe();
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "sibling",
      displayName: "Bro",
    });
    expect(res.allowed).toBe(true);

    // Exactly TWO placeholder persons were minted, both anonymous (identified=false).
    expect(res.bridgePersonIds).toHaveLength(2);
    expect(res.bridgePersonId).toBe(res.bridgePersonIds![0]); // back-compat: first placeholder
    const [b1, b2] = res.bridgePersonIds!;
    expect((await personRow(b1!)).identified).toBe(false);
    expect((await personRow(b2!)).identified).toBe(false);

    // The two placeholders are partnered.
    const partnerEdges = await db
      .select()
      .from(kinshipAssertions)
      .where(eq(kinshipAssertions.edgeType, "partnered_with"));
    expect(partnerEdges).toHaveLength(1);

    // 4 parent_of edges: each placeholder is a parent of BOTH me and the sibling.
    const parentEdges = await db
      .select()
      .from(kinshipAssertions)
      .where(eq(kinshipAssertions.edgeType, "parent_of"));
    expect(parentEdges).toHaveLength(4);

    // me and the sibling share the SAME two parents → full sibling, not half.
    expect(await shareBothParents(fam.id, me.id, me.id, res.createdPersonId!)).toBe(true);
    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("sibling");
  });

  // Case 2: anchor with ONE existing parent → mint ONE placeholder; A and B share TWO parents.
  it("from an anchor with one existing parent: mints ONE placeholder and both siblings share two parents", async () => {
    const { me, fam } = await familyWithMe();
    const parentRes = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Mom",
    });
    const momId = parentRes.createdPersonId!;

    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "sibling",
      displayName: "Sis",
    });
    expect(res.allowed).toBe(true);
    expect(res.bridgePersonIds).toHaveLength(1); // one placeholder minted to complete the couple
    const q = res.bridgePersonIds![0]!;
    expect((await personRow(q)).identified).toBe(false);

    // The new placeholder is partnered with the existing parent.
    const partnerEdges = await db
      .select()
      .from(kinshipAssertions)
      .where(eq(kinshipAssertions.edgeType, "partnered_with"));
    expect(partnerEdges).toHaveLength(1);

    // me and the sibling now share the SAME two parents (Mom + the placeholder).
    const meParents = (await parentIdsOf(fam.id, me.id, me.id)).sort();
    expect(meParents).toEqual([momId, q].sort());
    expect(await shareBothParents(fam.id, me.id, me.id, res.createdPersonId!)).toBe(true);
    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("sibling");
  });

  // Case 3: anchor already has a full couple → reuse it, mint NOTHING.
  it("from an anchor with a full parent-couple: mints NOTHING and attaches the sibling to both existing parents", async () => {
    const { me, fam } = await familyWithMe();
    // Give me a full couple: two parents (Mom + Dad as a co-parent on a shared child edge is not the
    // shape here; instead assert Mom, then Dad, each as a parent of me directly).
    const mom = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Mom",
    });
    const dad = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Dad",
    });
    const momId = mom.createdPersonId!;
    const dadId = dad.createdPersonId!;
    expect((await parentIdsOf(fam.id, me.id, me.id)).sort()).toEqual([momId, dadId].sort());

    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "sibling",
      displayName: "Sib",
    });
    expect(res.allowed).toBe(true);
    expect(res.bridgePersonIds).toBeUndefined(); // no placeholders minted
    expect(res.bridgePersonId).toBeUndefined();
    expect(res.edgeIds).toHaveLength(2); // sibling attached below both existing parents

    const sibParents = (await parentIdsOf(fam.id, me.id, res.createdPersonId!)).sort();
    expect(sibParents).toEqual([momId, dadId].sort());
    expect(await shareBothParents(fam.id, me.id, me.id, res.createdPersonId!)).toBe(true);
    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("sibling");
  });

  // Regression (repo policy): the shipped single-bridge shortcut yielded a HALF-sibling (one shared
  // parent). ADR-0017 forbids that for Add sibling — every "add sibling" must yield a FULL sibling
  // (two shared parents → deriveKin labels `sibling`, not `half_sibling`).
  it("regression: sibling add never yields a half-sibling in v1 (always two shared parents)", async () => {
    // Parentless anchor is the case that used to produce a half-sibling (single shared bridge).
    const { me, fam } = await familyWithMe();
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "sibling",
      displayName: "Twin",
    });
    expect(res.allowed).toBe(true);
    // Both siblings must have EXACTLY two parents, and they must be the SAME two (full sibling).
    expect((await parentIdsOf(fam.id, me.id, me.id))).toHaveLength(2);
    expect((await parentIdsOf(fam.id, me.id, res.createdPersonId!))).toHaveLength(2);
    expect(await shareBothParents(fam.id, me.id, me.id, res.createdPersonId!)).toBe(true);
    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("sibling");
  });

  // Case 2b (single-partner rule): when the anchor's one recorded parent ALREADY has a partner,
  // reuse that real partner as the second parent — never mint a ghost (that would give P two partners).
  it("from a 1-parent anchor whose parent already has a partner: reuses that partner as the second parent, mints NO placeholder", async () => {
    const { me, fam } = await familyWithMe();
    // me has one parent P (Mom); give P a real partner R (Dad) via a partner add anchored on Mom.
    const mom = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Mom",
    });
    const momId = mom.createdPersonId!;
    const dad = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "partner",
      displayName: "Dad",
      anchorPersonId: momId,
    });
    const dadId = dad.createdPersonId!;
    // Precondition: me still has exactly ONE recorded parent (Dad is Mom's partner, not yet my parent).
    expect((await parentIdsOf(fam.id, me.id, me.id))).toEqual([momId]);

    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "sibling",
      displayName: "Sis",
    });
    expect(res.allowed).toBe(true);
    // No ghost minted — the real partner R was reused.
    expect(res.bridgePersonIds).toBeUndefined();
    expect(res.bridgePersonId).toBeUndefined();

    // Exactly ONE partnership in the family (Mom—Dad); no second (ghost) partnership for Mom.
    const partnerEdges = await db
      .select()
      .from(kinshipAssertions)
      .where(eq(kinshipAssertions.edgeType, "partnered_with"));
    expect(partnerEdges).toHaveLength(1);

    // me and the sibling now share the SAME two REAL parents {Mom, Dad}.
    const meParents = (await parentIdsOf(fam.id, me.id, me.id)).sort();
    expect(meParents).toEqual([momId, dadId].sort());
    expect(await shareBothParents(fam.id, me.id, me.id, res.createdPersonId!)).toBe(true);
    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("sibling");
  });

  // Case 4 (over-full): first-asserter-wins can leave an anchor with 3+ recorded parents. A sibling
  // then shares ALL of them and mints nothing (explicit, documented behavior).
  it("from an anchor with 3 recorded parents: shares all 3 with the sibling, mints NOTHING", async () => {
    const { me, fam } = await familyWithMe();
    const p1 = (await addRelative(db, account(me.id), { familyId: fam.id, relation: "parent", displayName: "P1" })).createdPersonId!;
    const p2 = (await addRelative(db, account(me.id), { familyId: fam.id, relation: "parent", displayName: "P2" })).createdPersonId!;
    const p3 = (await addRelative(db, account(me.id), { familyId: fam.id, relation: "parent", displayName: "P3" })).createdPersonId!;
    expect((await parentIdsOf(fam.id, me.id, me.id)).sort()).toEqual([p1, p2, p3].sort());

    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "sibling",
      displayName: "Sib",
    });
    expect(res.allowed).toBe(true);
    expect(res.bridgePersonIds).toBeUndefined(); // nothing minted
    expect(res.edgeIds).toHaveLength(3); // sibling attached below all three existing parents

    const sibParents = (await parentIdsOf(fam.id, me.id, res.createdPersonId!)).sort();
    expect(sibParents).toEqual([p1, p2, p3].sort());
    expect(await relationOf(fam.id, me.id, res.createdPersonId!)).toBe("sibling");
  });

  // anchor !== me exercising the 1-parent top-up path (mints one ghost to complete `other`'s couple).
  it("anchored on another member with one parent: tops that member's parents up to a couple (one placeholder), sibling shares both", async () => {
    const { db, ctx, familyId, mePersonId, otherPersonId } = await seedTwoMemberFamily();
    // Give `other` exactly one recorded parent (no partner), anchored on other.
    const parent = await addRelative(db, ctx, {
      familyId,
      relation: "parent",
      displayName: "OtherMom",
      anchorPersonId: otherPersonId,
    });
    const otherMomId = parent.createdPersonId!;
    expect((await parentIdsOf(familyId, mePersonId, otherPersonId))).toEqual([otherMomId]);

    const res = await addRelative(db, ctx, {
      familyId,
      relation: "sibling",
      displayName: "OtherSib",
      anchorPersonId: otherPersonId,
    });
    expect(res.allowed).toBe(true);
    expect(res.bridgePersonIds).toHaveLength(1); // one ghost minted to complete other's couple
    const q = res.bridgePersonIds![0]!;

    // `other` now has two parents {OtherMom, ghost}; the sibling shares the SAME two.
    const otherParents = (await parentIdsOf(familyId, mePersonId, otherPersonId)).sort();
    expect(otherParents).toEqual([otherMomId, q].sort());
    expect(await shareBothParents(familyId, mePersonId, otherPersonId, res.createdPersonId!)).toBe(true);
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

/** Count all persons rows — used to prove `linkExistingMember` mints NO duplicate for the member. */
async function personCount(): Promise<number> {
  const rows = await db.select({ id: persons.id }).from(persons);
  return rows.length;
}

describe("linkExistingMember (#161)", () => {
  it("links an existing member as a parent of the anchor — creates the edge, mints NO duplicate person", async () => {
    const { db, ctx, familyId, mePersonId, otherPersonId } = await seedTwoMemberFamily();
    const before = await personCount();

    const res = await linkExistingMember(db, ctx, {
      familyId,
      relation: "parent",
      existingPersonId: otherPersonId, // `other` becomes a parent of `me` (the default anchor)
    });
    expect(res.allowed).toBe(true);
    expect(res.edgeIds).toHaveLength(1);

    // No new Person minted for the linked member (a direct parent link mints no bridge either).
    expect(await personCount()).toBe(before);

    // The edge places `other` as a parent of `me`.
    const { edges } = await resolveKinshipProjection(db, ctx, familyId);
    const edge = edges.find(
      (e) => e.edgeType === "parent_of" && e.personAId === otherPersonId && e.personBId === mePersonId,
    );
    expect(edge).toBeDefined();
    expect(deriveKin(edges, mePersonId).find((k) => k.personId === otherPersonId)?.relation).toBe("parent");
  });

  it("links an existing member as a partner of a chosen anchor", async () => {
    const { db, ctx, familyId, mePersonId, otherPersonId } = await seedTwoMemberFamily();
    const res = await linkExistingMember(db, ctx, {
      familyId,
      relation: "partner",
      anchorPersonId: mePersonId,
      existingPersonId: otherPersonId,
    });
    expect(res.allowed).toBe(true);
    const { edges } = await resolveKinshipProjection(db, ctx, familyId);
    expect(deriveKin(edges, mePersonId).find((k) => k.personId === otherPersonId)?.relation).toBe("partner");
  });

  it("links an existing member as a CHILD of the anchor — single parent_of edge, no member dupe", async () => {
    const { db, ctx, familyId, mePersonId, otherPersonId } = await seedTwoMemberFamily();
    const before = await personCount();

    // `other` becomes a child of `me` (the default anchor).
    const res = await linkExistingMember(db, ctx, {
      familyId,
      relation: "child",
      anchorPersonId: mePersonId,
      existingPersonId: otherPersonId,
    });
    expect(res.allowed).toBe(true);
    expect(res.edgeIds).toHaveLength(1);
    // No duplicate person minted for the linked member.
    expect(await personCount()).toBe(before);

    const { edges } = await resolveKinshipProjection(db, ctx, familyId);
    const edge = edges.find(
      (e) => e.edgeType === "parent_of" && e.personAId === mePersonId && e.personBId === otherPersonId,
    );
    expect(edge).toBeDefined();
    expect(deriveKin(edges, mePersonId).find((k) => k.personId === otherPersonId)?.relation).toBe("child");
  });

  it("links a child with a distinct valid co-parent — BOTH parent_of edges, no member dupe", async () => {
    // Three members: me (anchor), coParent, and the child being linked.
    const me = await makePerson(db, "Me");
    const coParent = await makePerson(db, "CoParent");
    const kid = await makePerson(db, "Kid");
    const fam = await makeFamily(db, "Esposito", me.id);
    await addMembership(db, { personId: me.id, familyId: fam.id, role: "member" });
    await addMembership(db, { personId: coParent.id, familyId: fam.id, role: "member" });
    await addMembership(db, { personId: kid.id, familyId: fam.id, role: "member" });
    const ctx = account(me.id);
    const before = (await db.select({ id: persons.id }).from(persons)).length;

    const res = await linkExistingMember(db, ctx, {
      familyId: fam.id,
      relation: "child",
      anchorPersonId: me.id,
      existingPersonId: kid.id,
      coParentPersonId: coParent.id,
    });
    expect(res.allowed).toBe(true);
    expect(res.edgeIds).toHaveLength(2);
    // No duplicate person minted for the linked member (nor the co-parent).
    expect((await db.select({ id: persons.id }).from(persons)).length).toBe(before);

    const { edges } = await resolveKinshipProjection(db, ctx, fam.id);
    const parentsOfKid = edges
      .filter((e) => e.edgeType === "parent_of" && e.personBId === kid.id)
      .map((e) => e.personAId)
      .sort();
    expect(parentsOfKid).toEqual([me.id, coParent.id].sort());
  });

  it("BLOCKING: rejects coParentPersonId === existingPersonId (would make the child its own parent)", async () => {
    const { db, ctx, familyId, mePersonId, otherPersonId } = await seedTwoMemberFamily();
    const before = await personCount();

    const res = await linkExistingMember(db, ctx, {
      familyId,
      relation: "child",
      anchorPersonId: mePersonId,
      existingPersonId: otherPersonId,
      coParentPersonId: otherPersonId, // the child cannot be its own co-parent
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/co-?parent|self/i);

    // NOTHING written — no self-loop parent_of(X,X) row, no partial single-parent edge.
    const rows = await db.select().from(kinshipAssertions);
    expect(rows).toHaveLength(0);
    // And no person minted.
    expect(await personCount()).toBe(before);
  });

  it("sibling link mints the bridge couple but NO duplicate of the linked member", async () => {
    const { db, ctx, familyId, mePersonId, otherPersonId } = await seedTwoMemberFamily();
    const before = await personCount();

    // Link `other` as a sibling of `me` (parentless anchor → mints TWO placeholder parents).
    const res = await linkExistingMember(db, ctx, {
      familyId,
      relation: "sibling",
      anchorPersonId: mePersonId,
      existingPersonId: otherPersonId,
    });
    expect(res.allowed).toBe(true);
    expect(res.bridgePersonIds).toHaveLength(2); // two placeholder parents minted

    // Two bridges minted, but NOT a duplicate of `other`.
    expect(await personCount()).toBe(before + 2);

    const { edges } = await resolveKinshipProjection(db, ctx, familyId);
    expect(deriveKin(edges, mePersonId).find((k) => k.personId === otherPersonId)?.relation).toBe("sibling");
  });

  it("grandparent link tops up a bridge parent when the anchor has none, no member dupe", async () => {
    const { db, ctx, familyId, mePersonId, otherPersonId } = await seedTwoMemberFamily();
    const before = await personCount();

    const res = await linkExistingMember(db, ctx, {
      familyId,
      relation: "grandparent",
      anchorPersonId: mePersonId,
      existingPersonId: otherPersonId,
    });
    expect(res.allowed).toBe(true);
    expect(res.bridgePersonIds).toHaveLength(1); // one anonymous bridge parent
    expect(await personCount()).toBe(before + 1);

    const { edges } = await resolveKinshipProjection(db, ctx, familyId);
    expect(deriveKin(edges, mePersonId).find((k) => k.personId === otherPersonId)?.relation).toBe("grandparent");
  });

  it("denies an anonymous caller", async () => {
    const { db, familyId, otherPersonId } = await seedTwoMemberFamily();
    const res = await linkExistingMember(db, { kind: "anonymous" }, {
      familyId,
      relation: "parent",
      existingPersonId: otherPersonId,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/not signed in/i);
  });

  it("denies when the actor is not a member of the family", async () => {
    const { db, familyId, otherPersonId } = await seedTwoMemberFamily();
    const stranger = await makePerson(db, "Stranger");
    const res = await linkExistingMember(db, account(stranger.id), {
      familyId,
      relation: "parent",
      existingPersonId: otherPersonId,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/not a member/i);
  });

  it("denies when existingPersonId is not an active member of the family", async () => {
    const { db, ctx, familyId } = await seedTwoMemberFamily();
    // A person that exists but is not a member of this family.
    const outsider = await makePerson(db, "Outsider");
    const res = await linkExistingMember(db, ctx, {
      familyId,
      relation: "parent",
      existingPersonId: outsider.id,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/not an active member/i);
    // Nothing written.
    const rows = await db.select().from(kinshipAssertions);
    expect(rows).toHaveLength(0);
  });

  it("denies a self-link (existingPersonId === anchorPersonId)", async () => {
    const { db, ctx, familyId, mePersonId } = await seedTwoMemberFamily();
    const res = await linkExistingMember(db, ctx, {
      familyId,
      relation: "partner",
      anchorPersonId: mePersonId,
      existingPersonId: mePersonId,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/same person|self/i);
  });

  it("denies when the anchor is not attachable in this family", async () => {
    const { db, ctx, familyId, otherPersonId } = await seedTwoMemberFamily();
    // An anchor that is neither a member nor visible in the projection.
    const strangerAnchor = await makePerson(db, "StrangerAnchor");
    const res = await linkExistingMember(db, ctx, {
      familyId,
      relation: "parent",
      anchorPersonId: strangerAnchor.id,
      existingPersonId: otherPersonId,
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/anchor/i);
  });
});
