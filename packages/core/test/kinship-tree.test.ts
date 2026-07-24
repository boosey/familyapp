/**
 * Tests for `resolveKinshipTree` (ADR-0016, kinship tree viz spec §5): the bounded, root-anchored
 * neighborhood read behind the visual tree renderer. Verifies it inherits the projection's auth +
 * subject-hide overlay, windows the HYDRATION/PAYLOAD (not the whole family), sets the boundary
 * `hasHidden*` flags from edge existence beyond the window without hydrating those extra persons,
 * attaches `relationToRoot` via `deriveKin`, and merges cleanly across re-centered follow-up reads.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { kinshipAssertions, kinshipSubjectHides } from "@chronicle/db/kinship";
import { persons } from "@chronicle/db/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  addMembership,
  normalizeEdgeEndpoints,
  resolveKinshipTree,
  DEFAULT_TREE_WINDOW,
  type KinshipTreeData,
  type TreeNode,
} from "../src/index";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string) => ({ kind: "account", personId }) as const;

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

/** A person with explicit life fields, for hydration assertions. */
async function makePersonFull(
  db: Database,
  opts: {
    displayName?: string | null;
    identified?: boolean;
    lifeStatus?: "living" | "deceased";
    birthYear?: number | null;
    deathYear?: number | null;
    sex?: "male" | "female" | "unknown" | null;
  },
) {
  const [p] = await db
    .insert(persons)
    .values({
      displayName: opts.displayName ?? null,
      spokenName: opts.displayName ?? null,
      identified: opts.identified ?? true,
      lifeStatus: opts.lifeStatus ?? "living",
      birthYear: opts.birthYear ?? null,
      deathYear: opts.deathYear ?? null,
      sex: opts.sex,
    })
    .returning();
  return p!;
}

/** A family with `member` as an active member (so they may read its tree). */
async function familyWithMember(memberName = "Reader") {
  const member = await makePerson(db, memberName);
  const fam = await makeFamily(db, "Esposito", member.id);
  await addMembership(db, { personId: member.id, familyId: fam.id, role: "member" });
  return { member, fam };
}

function node(tree: KinshipTreeData, id: string): TreeNode | undefined {
  return tree.nodes.find((n) => n.personId === id);
}
function nodeIds(tree: KinshipTreeData): Set<string> {
  return new Set(tree.nodes.map((n) => n.personId));
}

describe("resolveKinshipTree — authorization (inherited from projection)", () => {
  it("rejects a viewer who is not an active member of the family", async () => {
    const { fam } = await familyWithMember();
    const stranger = await makePerson(db, "Stranger");
    await expect(
      resolveKinshipTree(db, account(stranger.id), fam.id, stranger.id),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects an anonymous viewer", async () => {
    const { fam, member } = await familyWithMember();
    await expect(
      resolveKinshipTree(db, { kind: "anonymous" }, fam.id, member.id),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("resolveKinshipTree — subject-hide overlay (inherited)", () => {
  it("suppresses an edge (and the person it would have pulled in) when a subject hides it", async () => {
    const { member, fam } = await familyWithMember();
    const child = member; // root is the child
    const parent = await makePerson(db, "Hidden Parent");
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: parent.id, b: child.id, actor: member.id });
    // Subject (the child = root) hides the edge → it must not appear, and the parent isn't materialized.
    await hide(db, { familyId: fam.id, edgeType: "parent_of", a: parent.id, b: child.id, subject: child.id, hidden: true });

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, child.id);
    expect(nodeIds(tree)).toEqual(new Set([child.id]));
    expect(tree.edges).toHaveLength(0);
    // No hidden-parent flag: a hidden edge is INVISIBLE, not merely out-of-window.
    expect(node(tree, child.id)!.hasHiddenParents).toBe(false);
  });
});

describe("resolveKinshipTree — root defaulting / invalid root", () => {
  it("a lone root (no kin) returns just the root node, no edges", async () => {
    const { member, fam } = await familyWithMember();
    const tree = await resolveKinshipTree(db, account(member.id), fam.id, member.id);
    expect(nodeIds(tree)).toEqual(new Set([member.id]));
    expect(tree.edges).toHaveLength(0);
    expect(node(tree, member.id)!.relationToRoot).toBe("self");
    expect(node(tree, member.id)!.hasHiddenParents).toBe(false);
    expect(node(tree, member.id)!.hasHiddenChildren).toBe(false);
  });

  it("an invalid root (person not in this family projection) returns an empty, rooted result", async () => {
    // A member may read the family, but roots on a person who has no edges AND is not a real person id.
    const { member, fam } = await familyWithMember();
    const ghostId = "00000000-0000-0000-0000-000000000000";
    const tree = await resolveKinshipTree(db, account(member.id), fam.id, ghostId);
    expect(tree.familyId).toBe(fam.id);
    expect(tree.rootPersonId).toBe(ghostId);
    expect(tree.nodes).toHaveLength(0);
    expect(tree.edges).toHaveLength(0);
  });

  it("does NOT leak a real person from another family when rooted on their id (cross-family guard)", async () => {
    // Regression for the integrated-review finding: a member could pass ?root=<any persons.id> and
    // have that person's name/birth/death hydrated even though they belong to another family / have
    // no edge here. The root is legitimate only if it is the viewer OR a visible-edge endpoint.
    const { member, fam } = await familyWithMember("Reader");
    // A real, named, dated person who is NOT a member of `fam` and has no edge in it (they live in
    // their own separate family with their own kin — irrelevant here).
    const outsider = await makePersonFull(db, {
      displayName: "Secret Sender",
      birthYear: 1950,
      lifeStatus: "deceased",
      deathYear: 1999,
    });
    const otherFam = await makeFamily(db, "Other", outsider.id);
    await addMembership(db, { personId: outsider.id, familyId: otherFam.id, role: "member" });

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, outsider.id);
    // No hydration, no leak: the outsider's name/dates must never surface in `fam`'s tree.
    expect(tree.nodes).toHaveLength(0);
    expect(tree.edges).toHaveLength(0);
    expect(node(tree, outsider.id)).toBeUndefined();
  });
});

describe("resolveKinshipTree — hydration + relationToRoot", () => {
  it("hydrates name/identified/lifeStatus/birthYear/deathYear and labels relations from root", async () => {
    const { member, fam } = await familyWithMember();
    const root = member;
    const parent = await makePersonFull(db, {
      displayName: "Nonna",
      lifeStatus: "deceased",
      birthYear: 1920,
      deathYear: 1998,
    });
    const child = await makePersonFull(db, { displayName: "Bambino", birthYear: 2010 });
    const anon = await makePersonFull(db, { displayName: null, identified: false }); // anonymous bridge grandparent

    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: parent.id, b: root.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: root.id, b: child.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: anon.id, b: parent.id, actor: member.id });

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, root.id);

    expect(node(tree, root.id)!.relationToRoot).toBe("self");

    const pn = node(tree, parent.id)!;
    expect(pn).toMatchObject({
      displayName: "Nonna",
      lifeStatus: "deceased",
      birthYear: 1920,
      deathYear: 1998,
      relationToRoot: "parent",
    });

    const cn = node(tree, child.id)!;
    expect(cn).toMatchObject({ displayName: "Bambino", birthYear: 2010, relationToRoot: "child" });

    const an = node(tree, anon.id)!;
    expect(an).toMatchObject({ displayName: null, identified: false, relationToRoot: "grandparent" });
  });

  it("relationToRoot is correct under a non-self root (re-centering)", async () => {
    const { member, fam } = await familyWithMember();
    const gp = await makePerson(db, "GP");
    const pa = await makePerson(db, "PA");
    const sib = await makePerson(db, "Sib");
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: gp.id, b: pa.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: pa.id, b: member.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: pa.id, b: sib.id, actor: member.id });

    // Root on the sibling: fixture shares one parent only → half_sibling (not full sibling).
    const tree = await resolveKinshipTree(db, account(member.id), fam.id, sib.id);
    expect(node(tree, sib.id)!.relationToRoot).toBe("self");
    expect(node(tree, member.id)!.relationToRoot).toBe("half_sibling");
    expect(node(tree, pa.id)!.relationToRoot).toBe("parent");
    expect(node(tree, gp.id)!.relationToRoot).toBe("grandparent");
  });
});

describe("resolveKinshipTree — sex projection (ADR-0016 tree card color)", () => {
  it("projects a person's sex and coalesces a null DB value to 'unknown'", async () => {
    const { member, fam } = await familyWithMember();
    const root = member;
    const dad = await makePersonFull(db, { displayName: "Dad", sex: "male" });
    const mystery = await makePersonFull(db, { displayName: "Mystery", sex: null });

    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: dad.id, b: root.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: mystery.id, b: root.id, actor: member.id });

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, root.id);

    expect(node(tree, dad.id)!.sex).toBe("male");
    // Null in the DB coalesces to "unknown" — never surfaced as null.
    expect(node(tree, mystery.id)!.sex).toBe("unknown");
  });
});

describe("resolveKinshipTree — #372 membership + steward projection", () => {
  it("projects membership (tree-only vs member) and isSteward, family-scoped", async () => {
    // `familyWithMember` makes `member` the family creator ⇒ also its stewardPersonId.
    const { member, fam } = await familyWithMember("Steward");
    const root = member;

    // A plain edge endpoint with NO active membership in this family → "tree-only", not steward.
    const treeOnlyParent = await makePerson(db, "TreeOnly Parent");
    // Another ACTIVE member of the family (non-steward) → "member", isSteward false.
    const otherMember = await makePerson(db, "Other Member");
    await addMembership(db, { personId: otherMember.id, familyId: fam.id, role: "member" });

    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: treeOnlyParent.id, b: root.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: otherMember.id, b: root.id, actor: member.id });

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, root.id);

    // Steward (the root/creator): member + steward.
    expect(node(tree, root.id)!.membership).toBe("member");
    expect(node(tree, root.id)!.isSteward).toBe(true);

    // Plain edge endpoint, no membership → tree-only, not steward.
    expect(node(tree, treeOnlyParent.id)!.membership).toBe("tree-only");
    expect(node(tree, treeOnlyParent.id)!.isSteward).toBe(false);

    // Active member who is not the steward → member, isSteward false.
    expect(node(tree, otherMember.id)!.membership).toBe("member");
    expect(node(tree, otherMember.id)!.isSteward).toBe(false);
  });

  it("is family-scoped: standing in ANOTHER family never leaks into this family's tree", async () => {
    // `crossPerson` is a MEMBER + STEWARD of their own separate family, and a bare edge endpoint
    // (no membership) in `fam`. Both projected facts must be family-scoped: within `fam` they must
    // read tree-only + isSteward:false, regardless of their standing elsewhere.
    const { member, fam } = await familyWithMember("Reader");
    const crossPerson = await makePerson(db, "Cross Family");
    const otherFam = await makeFamily(db, "Other", crossPerson.id); // crossPerson is its steward
    await addMembership(db, { personId: crossPerson.id, familyId: otherFam.id, role: "member" });

    // In THIS family, crossPerson is only a plain edge endpoint (no membership here).
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: crossPerson.id, b: member.id, actor: member.id });

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, member.id);
    expect(node(tree, crossPerson.id)!.membership).toBe("tree-only");
    expect(node(tree, crossPerson.id)!.isSteward).toBe(false);
  });
});

describe("resolveKinshipTree — windowing + boundary flags", () => {
  it("does not materialize a person beyond the window but flags the in-window boundary node", async () => {
    const { member, fam } = await familyWithMember();
    // Chain UP: ggp -> gp -> pa -> root. With generationsUp:2, ggp (gen -3) is out; gp is the boundary.
    const ggp = await makePerson(db, "GreatGrandparent");
    const gp = await makePerson(db, "Grandparent");
    const pa = await makePerson(db, "Parent");
    const root = member;
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: ggp.id, b: gp.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: gp.id, b: pa.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: pa.id, b: root.id, actor: member.id });

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, root.id, {
      generationsUp: 2,
      generationsDown: 2,
    });

    // ggp is out of window → NOT materialized.
    expect(nodeIds(tree).has(ggp.id)).toBe(false);
    expect(nodeIds(tree)).toEqual(new Set([root.id, pa.id, gp.id]));
    // gp is the boundary: it HAS a parent (ggp) that wasn't materialized → hasHiddenParents.
    expect(node(tree, gp.id)!.hasHiddenParents).toBe(true);
    expect(node(tree, gp.id)!.hasHiddenChildren).toBe(false);
    // The boundary edge ggp->gp is returned to justify the flag; ggp is NOT a node.
    const boundaryEdge = tree.edges.find(
      (e) => e.edgeType === "parent_of" && e.personAId === ggp.id && e.personBId === gp.id,
    );
    expect(boundaryEdge).toBeDefined();
  });

  it("flags hasHiddenChildren at the downward boundary", async () => {
    const { member, fam } = await familyWithMember();
    // root -> c -> gc -> ggc. generationsDown:2 → ggc out, gc is boundary.
    const root = member;
    const c = await makePerson(db, "Child");
    const gc = await makePerson(db, "Grandchild");
    const ggc = await makePerson(db, "GreatGrandchild");
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: root.id, b: c.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: c.id, b: gc.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: gc.id, b: ggc.id, actor: member.id });

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, root.id, {
      generationsUp: 2,
      generationsDown: 2,
    });
    expect(nodeIds(tree).has(ggc.id)).toBe(false);
    expect(node(tree, gc.id)!.hasHiddenChildren).toBe(true);
    expect(node(tree, gc.id)!.hasHiddenParents).toBe(false);
  });

  it("a narrow window (0/0) materializes only the root and flags both directions", async () => {
    const { member, fam } = await familyWithMember();
    const pa = await makePerson(db, "Parent");
    const child = await makePerson(db, "Child");
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: pa.id, b: member.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: member.id, b: child.id, actor: member.id });

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, member.id, {
      generationsUp: 0,
      generationsDown: 0,
    });
    expect(nodeIds(tree)).toEqual(new Set([member.id]));
    expect(node(tree, member.id)!.hasHiddenParents).toBe(true);
    expect(node(tree, member.id)!.hasHiddenChildren).toBe(true);
  });
});

describe("resolveKinshipTree — partners share a generation", () => {
  it("includes a partner at the same generation and its subtree within the window", async () => {
    const { member, fam } = await familyWithMember();
    const partner = await makePerson(db, "Partner");
    const child = await makePerson(db, "Child");
    await assert(db, { familyId: fam.id, edgeType: "partnered_with", a: member.id, b: partner.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: partner.id, b: child.id, actor: member.id });

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, member.id, {
      generationsUp: 0,
      generationsDown: 1,
    });
    // partner is gen 0 (same as root), child is gen +1 (partner's child) — both reachable in window.
    expect(nodeIds(tree)).toEqual(new Set([member.id, partner.id, child.id]));
    expect(node(tree, partner.id)!.relationToRoot).toBe("partner");
    // The partner's child is a step-child of root — NOT modeled by the two primitives, so relationToRoot is null.
    expect(node(tree, child.id)!.relationToRoot).toBeNull();
    // But its downward edge IS drawn, and the child can have hidden children of its own (none here).
    expect(node(tree, child.id)!.hasHiddenChildren).toBe(false);
  });
});

describe("resolveKinshipTree — generation is parent_of-authoritative (DAG / blended families)", () => {
  it("a person who is both a partner (same-gen) and a blood grandparent (gen -2) is placed by blood, not the partner hint", async () => {
    // Regression for the cold-review finding: first-reached-wins over mixed partner+parent edges could
    // mis-window a node. Topology:
    //   A parent_of root, C parent_of root      (A, C are root's parents → gen -1)
    //   B parent_of C                            (B is C's parent → gen -2, a grandparent by blood)
    //   B partnered_with A                       (B is also A's partner → the partner hint says gen -1)
    // Blood must win: B is gen -2. With generationsUp:2 B is the boundary; B's own parent is gen -3 (out).
    const { member, fam } = await familyWithMember();
    const root = member;
    const a = await makePerson(db, "A");
    const c = await makePerson(db, "C");
    const b = await makePerson(db, "B");
    const bParent = await makePerson(db, "B-parent"); // gen -3, must stay out
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: a.id, b: root.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: c.id, b: root.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: b.id, b: c.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "partnered_with", a: b.id, b: a.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: bParent.id, b: b.id, actor: member.id });

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, root.id, {
      generationsUp: 2,
      generationsDown: 0,
    });
    // B (gen -2) is materialized; B's parent (gen -3) is NOT.
    expect(nodeIds(tree).has(b.id)).toBe(true);
    expect(nodeIds(tree).has(bParent.id)).toBe(false);
    // B is the upward boundary: it has a hidden parent.
    expect(node(tree, b.id)!.hasHiddenParents).toBe(true);
    // relationToRoot is derived independently of windowing: B is a grandparent of root (via C).
    expect(node(tree, b.id)!.relationToRoot).toBe("grandparent");
  });
});

describe("resolveKinshipTree — merge across re-centered follow-up reads", () => {
  it("a follow-up read centered elsewhere merges with no duplicate nodes/edges", async () => {
    const { member, fam } = await familyWithMember();
    // Deep chain: gp -> pa -> root -> c -> gc
    const gp = await makePerson(db, "GP");
    const pa = await makePerson(db, "PA");
    const root = member;
    const c = await makePerson(db, "C");
    const gc = await makePerson(db, "GC");
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: gp.id, b: pa.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: pa.id, b: root.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: root.id, b: c.id, actor: member.id });
    await assert(db, { familyId: fam.id, edgeType: "parent_of", a: c.id, b: gc.id, actor: member.id });

    const win = { generationsUp: 1, generationsDown: 1 };
    const first = await resolveKinshipTree(db, account(member.id), fam.id, root.id, win);
    // Re-center on the child to reveal gc (was beyond root's window).
    const second = await resolveKinshipTree(db, account(member.id), fam.id, c.id, win);

    // Simulate the client merge (dedup by personId / normalized edge key).
    const mergedNodes = new Map<string, TreeNode>();
    for (const n of [...first.nodes, ...second.nodes]) mergedNodes.set(n.personId, n);
    const edgeKey = (e: (typeof first.edges)[number]) =>
      `${e.edgeType}|${e.personAId}|${e.personBId}`;
    const mergedEdges = new Map<string, (typeof first.edges)[number]>();
    for (const e of [...first.edges, ...second.edges]) mergedEdges.set(edgeKey(e), e);

    // first(root,±1) = {pa, root, c}; second(c,±1) = {root, c, gc}. Union = {pa, root, c, gc}.
    // gp stays beyond BOTH windows, so it is never materialized — only flagged (hidden parent of pa).
    expect(new Set(mergedNodes.keys())).toEqual(new Set([pa.id, root.id, c.id, gc.id]));
    expect(mergedNodes.get(gc.id)).toBeDefined();
    // pa->root and root->c are seen by BOTH reads; after keyed merge each appears exactly once.
    // Materialized edges among the union: pa->root, root->c, c->gc. Plus the boundary edge gp->pa
    // (justifying pa.hasHiddenParents) is present in `first`. So keyed union = 4 distinct edges.
    expect(mergedEdges.size).toBe(4); // gp->pa (boundary), pa->root, root->c, c->gc
    // pa carries the hidden-parent flag (gp beyond window) in the first read.
    const paNode = [...first.nodes, ...second.nodes].find((n) => n.personId === pa.id)!;
    expect(paNode.hasHiddenParents).toBe(true);
  });
});

describe("resolveKinshipTree — large deep tree stays bounded", () => {
  it("first read materializes ≤ window, not the whole family", async () => {
    const { member, fam } = await familyWithMember();
    // Build a deep ancestral chain of 10 generations above root, plus 10 below.
    let prev = member.id;
    const ancestors: string[] = [];
    for (let i = 0; i < 10; i++) {
      const p = await makePerson(db, `Ancestor${i}`);
      ancestors.push(p.id);
      await assert(db, { familyId: fam.id, edgeType: "parent_of", a: p.id, b: prev, actor: member.id });
      prev = p.id;
    }
    prev = member.id;
    const descendants: string[] = [];
    for (let i = 0; i < 10; i++) {
      const c = await makePerson(db, `Descendant${i}`);
      descendants.push(c.id);
      await assert(db, { familyId: fam.id, edgeType: "parent_of", a: prev, b: c.id, actor: member.id });
      prev = c.id;
    }
    // Also give root many siblings (wide) to prove width is bounded by generation, not fetched wholesale.
    const paId = ancestors[0]!;
    for (let i = 0; i < 20; i++) {
      const sib = await makePerson(db, `Sibling${i}`);
      await assert(db, { familyId: fam.id, edgeType: "parent_of", a: paId, b: sib.id, actor: member.id });
    }

    const tree = await resolveKinshipTree(db, account(member.id), fam.id, member.id, DEFAULT_TREE_WINDOW);
    // Window ±2. Nodes: root + 2 ancestors + 2 descendants + 20 siblings (siblings are gen 0, in window).
    // The point: it does NOT include the 8 deeper ancestors nor the 8 deeper descendants.
    const ids = nodeIds(tree);
    expect(ids.has(ancestors[0]!)).toBe(true); // gen -1
    expect(ids.has(ancestors[1]!)).toBe(true); // gen -2
    expect(ids.has(ancestors[2]!)).toBe(false); // gen -3 out
    expect(ids.has(descendants[1]!)).toBe(true); // gen +2
    expect(ids.has(descendants[2]!)).toBe(false); // gen +3 out
    // The deep ancestor at the boundary (gen -2) flags hidden parents.
    expect(node(tree, ancestors[1]!)!.hasHiddenParents).toBe(true);
    expect(node(tree, descendants[1]!)!.hasHiddenChildren).toBe(true);
    // Bounded: nowhere near the ~40-person family.
    expect(tree.nodes.length).toBeLessThan(30);
  });
});
