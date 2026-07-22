// ---------------------------------------------------------------------------
// Pure kinship derivation — the client-safe half of the kinship read model.
//
// This module holds `deriveKin` and its types ONLY. It has NO value imports
// (DB, auth, crypto) — every import here is `import type`, which is erased at
// build time — so it is safe to pull into a client bundle (e.g. the tree
// renderer's `relabelToRoot` re-roots on the client). `kinship-repository.ts`
// re-exports these symbols, so the `@chronicle/core` barrel and every server
// consumer keep importing them from the same place as before.
//
// Gendering: the two stored primitives (`parent_of`, `partnered_with`) carry no
// sex, so we cannot distinguish mother/father or grandmother/grandfather.
// Gendered display labels are a later concern (needs a person attribute).
// ---------------------------------------------------------------------------

import type { KinshipEdgeType, KinshipNature, KinshipState } from "@chronicle/db";

/** A governance-resolved kinship edge (already visibility- and hide-filtered). */
export interface ResolvedKinshipEdge {
  edgeType: KinshipEdgeType;
  /** `parent_of`: the PARENT. `partnered_with`: the normalized lower-id endpoint. */
  personAId: string;
  /** `parent_of`: the CHILD. `partnered_with`: the normalized higher-id endpoint. */
  personBId: string;
  /** Set for `parent_of`, null for `partnered_with`. */
  nature: KinshipNature | null;
  /** The latest governance state — always one of the VISIBLE states here (never `denied`). */
  state: KinshipState;
  /** The ORIGINAL asserter (actor of the edge's earliest row) — audit / "who said so". */
  assertedBy: string;
  /** When the edge was first asserted, and when its latest transition landed. */
  assertedAt: Date;
  updatedAt: Date;
}

export type KinRelation =
  | "parent"
  | "child"
  | "partner"
  | "sibling"
  | "half_sibling"
  | "step_sibling"
  | "grandparent"
  | "grandchild"
  | "aunt_uncle"
  | "niece_nephew"
  | "cousin";

export interface DerivedKin {
  personId: string;
  relation: KinRelation;
}

/** Assign the CLOSEST relation when a person is reachable more than one way (e.g. also a partner).
 *  Also the canonical display-ordering rank for a viewer's kin list. */
export const RELATION_PRECEDENCE: readonly KinRelation[] = [
  "parent",
  "child",
  "partner",
  "sibling",
  "half_sibling",
  "step_sibling",
  "grandparent",
  "grandchild",
  "aunt_uncle",
  "niece_nephew",
  "cousin",
];

/**
 * Derive every labeled relative of `rootPersonId` from a resolved edge set (the output of
 * `resolveKinshipProjection`, so already visibility- and hide-filtered). Pure — no DB, no auth.
 * Covers the first- and second-degree relations. Sibling labels by shared `parent_of` count:
 * `sibling` = two shared parents, `half_sibling` = exactly one; `step_sibling` = a parent of root
 * is partnered-with a parent of the other with **no** shared `parent_of` (shared parent_of even
 * `nature=step` is half/full by count, never step). `cousin` = parents are siblings (share ≥1
 * parent). When a person qualifies for several relations the most specific (by precedence) wins.
 */
export function deriveKin(
  edges: ResolvedKinshipEdge[],
  rootPersonId: string,
): DerivedKin[] {
  // Adjacency from the two primitives.
  const parentsOf = new Map<string, Set<string>>(); // child -> parents
  const childrenOf = new Map<string, Set<string>>(); // parent -> children
  const partnersOf = new Map<string, Set<string>>(); // person -> partners

  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    let s = m.get(k);
    if (s === undefined) {
      s = new Set<string>();
      m.set(k, s);
    }
    s.add(v);
  };

  for (const e of edges) {
    if (e.edgeType === "parent_of") {
      add(parentsOf, e.personBId, e.personAId);
      add(childrenOf, e.personAId, e.personBId);
    } else {
      add(partnersOf, e.personAId, e.personBId);
      add(partnersOf, e.personBId, e.personAId);
    }
  }

  const get = (m: Map<string, Set<string>>, k: string): Set<string> =>
    m.get(k) ?? new Set<string>();

  /** Blood/adoptive co-children of x = others sharing ≥1 parent with x (used for aunt/niece walks). */
  const coChildrenOf = (x: string): Set<string> => {
    const out = new Set<string>();
    for (const p of get(parentsOf, x)) {
      for (const c of get(childrenOf, p)) {
        if (c !== x) out.add(c);
      }
    }
    return out;
  };

  const sharedParentCount = (a: string, b: string): number => {
    const bParents = get(parentsOf, b);
    let n = 0;
    for (const p of get(parentsOf, a)) {
      if (bParents.has(p)) n += 1;
    }
    return n;
  };

  // Collect candidates per relation, then pick the most specific per person.
  const candidates = new Map<string, Set<KinRelation>>();
  const mark = (personId: string, relation: KinRelation) => {
    if (personId === rootPersonId) return;
    add(candidates as Map<string, Set<string>>, personId, relation);
  };

  const parents = get(parentsOf, rootPersonId);
  const children = get(childrenOf, rootPersonId);

  for (const p of parents) mark(p, "parent");
  for (const c of children) mark(c, "child");
  for (const pt of get(partnersOf, rootPersonId)) mark(pt, "partner");

  // Full / half siblings by shared parent_of count (nature ignored — step parent_of still counts).
  for (const s of coChildrenOf(rootPersonId)) {
    const n = sharedParentCount(rootPersonId, s);
    if (n >= 2) mark(s, "sibling");
    else if (n === 1) mark(s, "half_sibling");
  }

  // Step-siblings: a parent of root is partnered-with a parent of other, and they share no parent_of.
  for (const p of parents) {
    for (const partner of get(partnersOf, p)) {
      for (const other of get(childrenOf, partner)) {
        if (other === rootPersonId) continue;
        if (sharedParentCount(rootPersonId, other) > 0) continue;
        mark(other, "step_sibling");
      }
    }
  }

  // grandparents = parents of parents; grandchildren = children of children.
  for (const p of parents) for (const gp of get(parentsOf, p)) mark(gp, "grandparent");
  for (const c of children) for (const gc of get(childrenOf, c)) mark(gc, "grandchild");

  // aunts/uncles = co-children of parents (share ≥1 parent); cousins = their children.
  for (const p of parents) {
    for (const au of coChildrenOf(p)) {
      mark(au, "aunt_uncle");
      for (const cousin of get(childrenOf, au)) mark(cousin, "cousin");
    }
  }
  // nieces/nephews = children of co-children (half and full).
  for (const s of coChildrenOf(rootPersonId)) {
    for (const nn of get(childrenOf, s)) mark(nn, "niece_nephew");
  }

  const result: DerivedKin[] = [];
  for (const [personId, rels] of candidates) {
    const relation = RELATION_PRECEDENCE.find((r) => rels.has(r));
    if (relation !== undefined) result.push({ personId, relation });
  }
  return result;
}
