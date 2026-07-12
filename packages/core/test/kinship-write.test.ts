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
