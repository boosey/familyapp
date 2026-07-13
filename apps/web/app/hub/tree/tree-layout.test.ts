// Pure unit tests for computeTreeLayout — no DB, no React. TDD-first per spec §Testing.
// Pedigree navigation: ancestors right (x>0), descendants left (x<0), focus at x=0.
import { describe, expect, it } from "vitest";
import type { ResolvedKinshipEdge, TreeNode } from "@chronicle/core";

import {
  EMPTY_EXPANSION,
  type ExpansionState,
  NODE_W,
  NODE_H,
  computeTreeLayout,
  type LayoutInput,
} from "./tree-layout";

// ---------------------------------------------------------------------------
// Fixture builders — match ResolvedKinshipEdge / TreeNode shapes exactly.
// ---------------------------------------------------------------------------

const T0 = new Date("2026-01-01T00:00:00Z");

function node(id: string, over: Partial<TreeNode> = {}): TreeNode {
  return {
    personId: id,
    displayName: id.toUpperCase(),
    identified: true,
    lifeStatus: "living",
    birthYear: null,
    deathYear: null,
    sex: "unknown",
    relationToRoot: null,
    hasHiddenParents: false,
    hasHiddenChildren: false,
    ...over,
  };
}

/** parent_of edge: A = parent, B = child. */
function parentOf(parent: string, child: string): ResolvedKinshipEdge {
  return {
    edgeType: "parent_of",
    personAId: parent,
    personBId: child,
    nature: "biological",
    state: "asserted",
    assertedBy: "someone",
    assertedAt: T0,
    updatedAt: T0,
  };
}

/** partnered_with edge: normalized so A is the lexicographically-lower id. */
function partneredWith(x: string, y: string): ResolvedKinshipEdge {
  const [a, b] = x < y ? [x, y] : [y, x];
  return {
    edgeType: "partnered_with",
    personAId: a,
    personBId: b,
    nature: null,
    state: "asserted",
    assertedBy: "someone",
    assertedAt: T0,
    updatedAt: T0,
  };
}

function expansion(over: Partial<ExpansionState> = {}): ExpansionState {
  return {
    expandedParents: new Set(),
    expandedChildren: new Set(),
    collapsedAncestors: new Set(),
    collapsedChildren: new Set(),
    ...over,
  };
}

function input(over: Partial<LayoutInput> & Pick<LayoutInput, "rootPersonId">): LayoutInput {
  return {
    nodes: [],
    edges: [],
    expansion: EMPTY_EXPANSION,
    ...over,
  };
}

function placedFor(layout: ReturnType<typeof computeTreeLayout>, id: string) {
  const p = layout.placed.find((n) => n.personId === id);
  if (!p)
    throw new Error(
      `expected ${id} to be placed; placed=${layout.placed.map((n) => n.personId).join(",")}`,
    );
  return p;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** gp -> parent -> root; root partnered with spouse; root+spouse -> child. */
function fixtureThreeGen(): LayoutInput {
  const nodes = [node("gp"), node("parent"), node("root"), node("spouse"), node("child")];
  const edges = [
    parentOf("gp", "parent"),
    parentOf("parent", "root"),
    partneredWith("root", "spouse"),
    parentOf("root", "child"),
    parentOf("spouse", "child"),
  ];
  return input({ rootPersonId: "root", nodes, edges });
}

// ---------------------------------------------------------------------------

describe("computeTreeLayout — generation assignment", () => {
  it("root is generation 0", () => {
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes: [node("me")] }));
    expect(placedFor(l, "me").generation).toBe(0);
  });

  it("parent is generation -1, child is generation +1", () => {
    const nodes = [node("me"), node("mom"), node("kid")];
    const edges = [parentOf("mom", "me"), parentOf("me", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(placedFor(l, "mom").generation).toBe(-1);
    expect(placedFor(l, "me").generation).toBe(0);
    expect(placedFor(l, "kid").generation).toBe(1);
  });

  it("partner shares the root's generation", () => {
    const nodes = [node("me"), node("spouse")];
    const edges = [partneredWith("me", "spouse")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(placedFor(l, "spouse").generation).toBe(0);
  });

  it("grandparent is generation -2", () => {
    const nodes = [node("me"), node("mom"), node("gran")];
    const edges = [parentOf("mom", "me"), parentOf("gran", "mom")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(placedFor(l, "gran").generation).toBe(-2);
  });
});

describe("computeTreeLayout — axis transpose (pedigree direction)", () => {
  it("ancestors land to the RIGHT (greater x), descendants to the LEFT, focus between", () => {
    const nodes = [node("me"), node("mom"), node("kid")];
    const edges = [parentOf("mom", "me"), parentOf("me", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const mom = placedFor(l, "mom"); // gen -1 (ancestor)
    const me = placedFor(l, "me"); // gen 0 (focus)
    const kid = placedFor(l, "kid"); // gen +1 (descendant)
    // Relative ordering after normalization: ancestor.x > focus.x > descendant.x
    expect(mom.x).toBeGreaterThan(me.x);
    expect(me.x).toBeGreaterThan(kid.x);
  });

  it("same generation shares an x column", () => {
    const nodes = [node("me"), node("sib"), node("mom")];
    const edges = [parentOf("mom", "me"), parentOf("mom", "sib")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const me = placedFor(l, "me");
    const sib = placedFor(l, "sib");
    expect(me.x).toBeCloseTo(sib.x, 5);
    // and they differ in y (stacked vertically within the column)
    expect(me.y).not.toBeCloseTo(sib.y, 5);
  });
});

describe("computeTreeLayout — within-column vertical order by birth year", () => {
  it("orders same-generation nodes by birthYear ascending (nulls last, id tiebreak)", () => {
    // Four siblings of `root`: a(1980), b(1975), c(null), d(null).
    // Expected top→down (ascending y): b(1975), a(1980), then nulls by id: c, d.
    const nodes = [
      node("root"),
      node("a", { birthYear: 1980 }),
      node("b", { birthYear: 1975 }),
      node("c", { birthYear: null }),
      node("d", { birthYear: null }),
      node("mom"),
    ];
    const edges = [
      parentOf("mom", "root"),
      parentOf("mom", "a"),
      parentOf("mom", "b"),
      parentOf("mom", "c"),
      parentOf("mom", "d"),
    ];
    const l = computeTreeLayout(input({ rootPersonId: "root", nodes, edges }));
    // Order the gen-0 nodes by y (top→down).
    const gen0 = l.placed
      .filter((p) => p.generation === 0)
      .sort((p, q) => p.y - q.y)
      .map((p) => p.personId);
    // Dated ones first (ascending year), then nulls in id order.
    // root has null birthYear too — it sorts among the nulls by id.
    // nulls by id: c, d, root.
    expect(gen0).toEqual(["b", "a", "c", "d", "root"]);
  });
});

describe("computeTreeLayout — partner union (vertical adjacency)", () => {
  it("emits a union with partners adjacent in the same x column (contiguous y)", () => {
    const nodes = [node("me"), node("spouse")];
    const edges = [partneredWith("me", "spouse")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(l.unions).toHaveLength(1);
    const me = placedFor(l, "me");
    const sp = placedFor(l, "spouse");
    // Share the x column (same generation → same x).
    expect(me.x).toBeCloseTo(sp.x, 5);
    // Adjacent: nobody sits vertically between them at this generation.
    const between = l.placed.filter(
      (n) => n.generation === 0 && n.y > Math.min(me.y, sp.y) && n.y < Math.max(me.y, sp.y),
    );
    expect(between).toHaveLength(0);
    expect(l.connectors.some((c) => c.kind === "partner")).toBe(true);
  });

  it("keeps union partners contiguous even with other same-gen nodes present", () => {
    // me+spouse are a union; sibA, sibB are also gen 0 (children of mom, as is me).
    const nodes = [
      node("me"),
      node("spouse"),
      node("sibA"),
      node("sibB"),
      node("mom"),
    ];
    const edges = [
      partneredWith("me", "spouse"),
      parentOf("mom", "me"),
      parentOf("mom", "sibA"),
      parentOf("mom", "sibB"),
    ];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const me = placedFor(l, "me");
    const sp = placedFor(l, "spouse");
    // Nobody drawn between the two union partners on the y axis.
    const between = l.placed.filter(
      (n) => n.generation === 0 && n.y > Math.min(me.y, sp.y) && n.y < Math.max(me.y, sp.y),
    );
    expect(between).toHaveLength(0);
  });
});

describe("computeTreeLayout — connectors (horizontal axis geometry)", () => {
  it("emits a descent connector for each parent→child edge drawn", () => {
    const nodes = [node("me"), node("kid")];
    const edges = [parentOf("me", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(l.connectors.filter((c) => c.kind === "descent").length).toBeGreaterThan(0);
    for (const c of l.connectors) expect(typeof c.d).toBe("string");
  });

  it("descent connector runs from parent LEFT edge to child RIGHT edge", () => {
    // parent (gen -1) is to the RIGHT of child (gen 0); so children hang to the left.
    const nodes = [node("me"), node("kid")];
    const edges = [parentOf("me", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const me = placedFor(l, "me"); // parent, gen 0
    const kid = placedFor(l, "kid"); // child, gen +1 → left of me
    expect(me.x).toBeGreaterThan(kid.x); // parent to the right
    const descent = l.connectors.find((c) => c.kind === "descent")!;
    // Path starts at parent's LEFT edge x = me.x - NODE_W/2
    const startX = me.x - NODE_W / 2;
    // Path ends at child's RIGHT edge x = kid.x + NODE_W/2
    const endX = kid.x + NODE_W / 2;
    expect(descent.d).toContain(`M ${startX} `);
    expect(descent.d).toContain(`L ${endX} `);
  });

  it("partner connector is vertical between the two cards' facing edges", () => {
    const nodes = [node("me"), node("spouse")];
    const edges = [partneredWith("me", "spouse")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const me = placedFor(l, "me");
    const sp = placedFor(l, "spouse");
    const upper = me.y < sp.y ? me : sp;
    const lower = me.y < sp.y ? sp : me;
    const partner = l.connectors.find((c) => c.kind === "partner")!;
    // Vertical: shares the column x, goes from lower card's top edge to upper card's bottom edge.
    // Endpoints x are equal (both ~ the shared column x).
    const topOfLower = lower.y - NODE_H / 2;
    const botOfUpper = upper.y + NODE_H / 2;
    expect(partner.d).toContain(`${topOfLower}`);
    expect(partner.d).toContain(`${botOfUpper}`);
    // both endpoints share the x column
    expect(me.x).toBeCloseTo(sp.x, 5);
  });
});

describe("computeTreeLayout — child centering on parents' y midpoint", () => {
  it("centers a single child on its parents' union y-midpoint", () => {
    const nodes = [node("me"), node("spouse"), node("kid")];
    const edges = [partneredWith("me", "spouse"), parentOf("me", "kid"), parentOf("spouse", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const me = placedFor(l, "me");
    const sp = placedFor(l, "spouse");
    const kid = placedFor(l, "kid");
    expect(kid.y).toBeCloseTo((me.y + sp.y) / 2, 5);
  });
});

describe("computeTreeLayout — bounded windowing + expansion reveal", () => {
  it("omits generations beyond ±2 of root by default", () => {
    const nodes = [node("me"), node("p1"), node("p2"), node("p3")];
    const edges = [parentOf("p1", "me"), parentOf("p2", "p1"), parentOf("p3", "p2")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(l.placed.some((n) => n.personId === "p2")).toBe(true); // g-2 in window
    expect(l.placed.some((n) => n.personId === "p3")).toBe(false); // g-3 out
  });

  it("reveals a beyond-window parent only when expandedParents includes the boundary node", () => {
    const nodes = [node("me"), node("p1"), node("p2"), node("p3")];
    const edges = [parentOf("p1", "me"), parentOf("p2", "p1"), parentOf("p3", "p2")];
    const l = computeTreeLayout(
      input({
        rootPersonId: "me",
        nodes,
        edges,
        expansion: expansion({ expandedParents: new Set(["p2"]) }),
      }),
    );
    expect(l.placed.some((n) => n.personId === "p3")).toBe(true);
    expect(placedFor(l, "p3").generation).toBe(-3);
  });

  it("keeps a revealed beyond-window node's partner as a union (regression)", () => {
    const nodes = [node("me"), node("p1"), node("p2"), node("p3"), node("p3b")];
    const edges = [
      parentOf("p1", "me"),
      parentOf("p2", "p1"),
      parentOf("p3", "p2"),
      partneredWith("p3", "p3b"),
    ];
    const l = computeTreeLayout(
      input({
        rootPersonId: "me",
        nodes,
        edges,
        expansion: expansion({ expandedParents: new Set(["p2"]) }),
      }),
    );
    expect(l.placed.some((n) => n.personId === "p3")).toBe(true);
    expect(l.placed.some((n) => n.personId === "p3b")).toBe(true);
    expect(placedFor(l, "p3b").generation).toBe(-3);
    expect(
      l.unions.some(
        (u) =>
          (u.aPersonId === "p3" && u.bPersonId === "p3b") ||
          (u.aPersonId === "p3b" && u.bPersonId === "p3"),
      ),
    ).toBe(true);
  });
});

describe("computeTreeLayout — per-edge affordances (fetch state)", () => {
  it("emits an ancestors 'fetch' affordance for a node with hasHiddenParents, on its RIGHT edge", () => {
    const nodes = [node("me", { hasHiddenParents: true })];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    const me = placedFor(l, "me");
    const aff = l.affordances.find((a) => a.direction === "ancestors" && a.personId === "me");
    expect(aff).toBeTruthy();
    expect(aff!.state).toBe("fetch");
    // Right (ancestor) edge.
    expect(aff!.x).toBeCloseTo(me.x + NODE_W / 2, 5);
    expect(aff!.y).toBeCloseTo(me.y, 5);
  });

  it("emits a descendants 'fetch' affordance for a node with hasHiddenChildren, on its LEFT edge", () => {
    const nodes = [node("me", { hasHiddenChildren: true })];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    const me = placedFor(l, "me");
    const aff = l.affordances.find((a) => a.direction === "descendants" && a.personId === "me");
    expect(aff).toBeTruthy();
    expect(aff!.state).toBe("fetch");
    // Left (descendant) edge.
    expect(aff!.x).toBeCloseTo(me.x - NODE_W / 2, 5);
    expect(aff!.y).toBeCloseTo(me.y, 5);
  });

  it("emits NO affordance when the node has no kin on that side", () => {
    const nodes = [node("me")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    expect(l.affordances).toHaveLength(0);
  });

  it("emits both affordances for a node with both hidden parents and hidden children", () => {
    const nodes = [node("me", { hasHiddenParents: true, hasHiddenChildren: true })];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    expect(l.affordances.some((a) => a.direction === "ancestors" && a.state === "fetch")).toBe(true);
    expect(l.affordances.some((a) => a.direction === "descendants" && a.state === "fetch")).toBe(true);
  });

  it("emits at most ONE affordance per (node, direction) — never two glyphs on one edge", () => {
    // me has a DRAWN parent (mom) and ALSO hidden parents. The drawn branch wins as a single control.
    const nodes = [node("me", { hasHiddenParents: true }), node("mom")];
    const edges = [parentOf("mom", "me")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const anc = l.affordances.filter((a) => a.direction === "ancestors" && a.personId === "me");
    expect(anc).toHaveLength(1);
  });
});

describe("computeTreeLayout — per-edge collapse / expand", () => {
  it("a node with drawn parents emits an ancestors affordance with state 'collapse'", () => {
    const nodes = [node("me"), node("mom")];
    const edges = [parentOf("mom", "me")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const aff = l.affordances.find((a) => a.direction === "ancestors" && a.personId === "me");
    expect(aff).toBeTruthy();
    expect(aff!.state).toBe("collapse");
  });

  it("collapsing an ancestor branch prunes it AND flips the affordance to 'expand'", () => {
    const nodes = [node("me"), node("mom"), node("gran")];
    const edges = [parentOf("mom", "me"), parentOf("gran", "mom")];
    const l = computeTreeLayout(
      input({
        rootPersonId: "me",
        nodes,
        edges,
        expansion: expansion({ collapsedAncestors: new Set(["me"]) }),
      }),
    );
    // The parent branch above `me` is pruned.
    expect(l.placed.some((n) => n.personId === "mom")).toBe(false);
    expect(l.placed.some((n) => n.personId === "gran")).toBe(false);
    // me is still drawn, and its ancestor affordance now offers to expand.
    const aff = l.affordances.find((a) => a.direction === "ancestors" && a.personId === "me");
    expect(aff).toBeTruthy();
    expect(aff!.state).toBe("expand");
  });

  it("a node with drawn children emits a descendants affordance with state 'collapse', collapse→expand+prune", () => {
    const nodes = [node("me"), node("kid"), node("grandkid")];
    const edges = [parentOf("me", "kid"), parentOf("kid", "grandkid")];
    const drawn = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(
      drawn.affordances.find((a) => a.direction === "descendants" && a.personId === "me")!.state,
    ).toBe("collapse");
    const collapsed = computeTreeLayout(
      input({
        rootPersonId: "me",
        nodes,
        edges,
        expansion: expansion({ collapsedChildren: new Set(["me"]) }),
      }),
    );
    expect(collapsed.placed.some((n) => n.personId === "kid")).toBe(false);
    expect(collapsed.placed.some((n) => n.personId === "grandkid")).toBe(false);
    expect(
      collapsed.affordances.find((a) => a.direction === "descendants" && a.personId === "me")!.state,
    ).toBe("expand");
  });
});

describe("computeTreeLayout — empty parent slots", () => {
  it("emits an EmptyParentSlot for a drawn node with zero drawn parents and NOT hasHiddenParents", () => {
    const nodes = [node("me")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    const me = placedFor(l, "me");
    expect(l.emptyParentSlots).toHaveLength(1);
    const slot = l.emptyParentSlots[0]!;
    expect(slot.personId).toBe("me");
    // On the ancestor (right) edge.
    expect(slot.x).toBeCloseTo(me.x + NODE_W / 2, 5);
    expect(slot.y).toBeCloseTo(me.y, 5);
  });

  it("does NOT emit an EmptyParentSlot when hasHiddenParents is true (a fetch affordance owns it)", () => {
    const nodes = [node("me", { hasHiddenParents: true })];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    expect(l.emptyParentSlots.some((s) => s.personId === "me")).toBe(false);
  });

  it("does NOT emit an EmptyParentSlot when the node has a drawn parent edge", () => {
    const nodes = [node("me"), node("mom")];
    const edges = [parentOf("mom", "me")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    // me has a drawn parent → no slot for me.
    expect(l.emptyParentSlots.some((s) => s.personId === "me")).toBe(false);
    // mom has no drawn parent and no hidden parents → gets a slot.
    expect(l.emptyParentSlots.some((s) => s.personId === "mom")).toBe(true);
  });

  it("does not emit slots for children/partner adds (only the ancestor side)", () => {
    // A childless node still gets a parent slot but nothing on the descendant side.
    const nodes = [node("me")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    for (const s of l.emptyParentSlots) {
      const me = placedFor(l, s.personId);
      // Always on the ancestor (right) edge.
      expect(s.x).toBeGreaterThan(me.x);
    }
  });

  it("emits a 'fetch' affordance (NOT an add-parent slot) for a drawn node with a LOADED-but-UNDRAWN parent (Finding 1)", () => {
    // Multi-hop ancestor reveal aftermath: p2 (gen -2, at the window edge) is drawn and has
    // hasHiddenParents:false, but a parent edge p3->p2 IS loaded with p3 as a node BEYOND the ±2
    // window (undrawn, because p2 is not in expandedParents). p2 therefore has a loaded-but-undrawn
    // parent — it must NOT get an "Add parent" slot (that would create a duplicate parent), and MUST
    // get an ancestors 'fetch' affordance so p3 stays reachable.
    const nodes = [
      node("me"),
      node("p1"),
      node("p2", { hasHiddenParents: false }),
      node("p3"),
    ];
    const edges = [parentOf("p1", "me"), parentOf("p2", "p1"), parentOf("p3", "p2")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    // p2 is drawn (gen -2 in window); p3 is loaded but NOT drawn (gen -3, no expandedParents).
    expect(l.placed.some((n) => n.personId === "p2")).toBe(true);
    expect(l.placed.some((n) => n.personId === "p3")).toBe(false);
    // No false add-parent slot on p2.
    expect(l.emptyParentSlots.some((s) => s.personId === "p2")).toBe(false);
    // An ancestors 'fetch' affordance IS emitted for p2, keeping the undrawn parent reachable.
    const aff = l.affordances.find((a) => a.direction === "ancestors" && a.personId === "p2");
    expect(aff).toBeTruthy();
    expect(aff!.state).toBe("fetch");
  });

  it("emits an EmptyParentSlot (and NO affordance) for a node with ZERO loaded parents and no hidden parents (Finding 1 mirror)", () => {
    const nodes = [node("me")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    expect(l.emptyParentSlots.some((s) => s.personId === "me")).toBe(true);
    expect(l.affordances.some((a) => a.direction === "ancestors" && a.personId === "me")).toBe(false);
  });
});

describe("computeTreeLayout — determinism", () => {
  it("same input yields byte-identical output across runs", () => {
    const nodes = [node("me"), node("mom"), node("dad"), node("kid")];
    const edges = [parentOf("mom", "me"), parentOf("dad", "me"), parentOf("me", "kid")];
    const a = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const b = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("shuffled node/edge order yields identical output", () => {
    const nodes = [node("me"), node("mom"), node("dad"), node("kid"), node("sib")];
    const edges = [
      parentOf("mom", "me"),
      parentOf("dad", "me"),
      parentOf("mom", "sib"),
      parentOf("dad", "sib"),
      parentOf("me", "kid"),
    ];
    const straight = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const shuffled = computeTreeLayout(
      input({
        rootPersonId: "me",
        nodes: [...nodes].reverse(),
        edges: [...edges].reverse(),
      }),
    );
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(straight));
  });
});

describe("computeTreeLayout — shared-grandparent DAG (cousins)", () => {
  it("positions cousins by generation and keeps a single node per person", () => {
    const nodes = [node("gp"), node("a"), node("b"), node("c1"), node("c2")];
    const edges = [
      parentOf("gp", "a"),
      parentOf("gp", "b"),
      parentOf("a", "c1"),
      parentOf("b", "c2"),
    ];
    const l = computeTreeLayout(input({ rootPersonId: "gp", nodes, edges }));
    expect(placedFor(l, "c1").generation).toBe(2);
    expect(placedFor(l, "c2").generation).toBe(2);
    expect(l.placed.map((n) => n.personId).sort()).toEqual(["a", "b", "c1", "c2", "gp"]);
  });
});

describe("computeTreeLayout — multiple partners", () => {
  it("places a node's two partners in the column as separate unions", () => {
    const nodes = [node("me"), node("x"), node("y")];
    const edges = [partneredWith("me", "x"), partneredWith("me", "y")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(placedFor(l, "x").generation).toBe(0);
    expect(placedFor(l, "y").generation).toBe(0);
    expect(l.unions.length).toBe(2);
  });
});

describe("computeTreeLayout — anonymous bridge", () => {
  it("places an anonymous (displayName=null) node and connects it", () => {
    const nodes = [node("me"), node("bridge", { displayName: null, identified: false }), node("gp")];
    const edges = [parentOf("bridge", "me"), parentOf("gp", "bridge")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(placedFor(l, "bridge").generation).toBe(-1);
    expect(placedFor(l, "bridge").node.displayName).toBeNull();
    // Connected on both sides: a descent edge into me and out of gp.
    expect(l.connectors.filter((c) => c.kind === "descent").length).toBeGreaterThanOrEqual(2);
  });
});

describe("computeTreeLayout — root only", () => {
  it("single node, no connectors, no unions", () => {
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes: [node("me")] }));
    expect(l.placed).toHaveLength(1);
    expect(l.connectors).toHaveLength(0);
    expect(l.unions).toHaveLength(0);
    expect(l.bounds.width).toBeGreaterThan(0);
    expect(l.bounds.height).toBeGreaterThan(0);
  });

  it("ignores nodes unreachable from root", () => {
    const nodes = [node("me"), node("stranger")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    expect(l.placed.map((n) => n.personId)).toEqual(["me"]);
  });
});

describe("computeTreeLayout — bounds", () => {
  it("bounds enclose every placed node", () => {
    const nodes = [node("me"), node("mom"), node("dad"), node("kid")];
    const edges = [parentOf("mom", "me"), parentOf("dad", "me"), parentOf("me", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    for (const p of l.placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(l.bounds.width);
      expect(p.y).toBeLessThanOrEqual(l.bounds.height);
    }
  });

  it("bounds enclose affordances and empty parent slots too", () => {
    const nodes = [
      node("me", { hasHiddenParents: true, hasHiddenChildren: true }),
      node("kid"),
    ];
    const edges = [parentOf("me", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    for (const c of l.affordances) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(l.bounds.width);
      expect(c.y).toBeLessThanOrEqual(l.bounds.height);
    }
    for (const s of l.emptyParentSlots) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(l.bounds.width);
      expect(s.y).toBeLessThanOrEqual(l.bounds.height);
    }
  });
});
