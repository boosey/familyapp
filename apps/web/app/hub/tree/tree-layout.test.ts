// Pure unit tests for computeTreeLayout — no DB, no React. TDD-first per spec §6/§10.
import { describe, expect, it } from "vitest";
import type { ResolvedKinshipEdge, TreeNode } from "@chronicle/core";

import {
  EMPTY_EXPANSION,
  type ExpansionState,
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
    collapsedGenerations: new Set(),
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
  if (!p) throw new Error(`expected ${id} to be placed; placed=${layout.placed.map((n) => n.personId).join(",")}`);
  return p;
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

describe("computeTreeLayout — partner union", () => {
  it("emits a union with partners placed adjacent at the same y", () => {
    const nodes = [node("me"), node("spouse")];
    const edges = [partneredWith("me", "spouse")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(l.unions).toHaveLength(1);
    const me = placedFor(l, "me");
    const sp = placedFor(l, "spouse");
    expect(me.y).toBe(sp.y);
    // Adjacent: no other node sits horizontally between them at this generation.
    const between = l.placed.filter(
      (n) => n.generation === 0 && n.x > Math.min(me.x, sp.x) && n.x < Math.max(me.x, sp.x),
    );
    expect(between).toHaveLength(0);
    // A partner connector exists.
    expect(l.connectors.some((c) => c.kind === "partner")).toBe(true);
  });
});

describe("computeTreeLayout — child centering", () => {
  it("centers a single child under its parents' union midpoint", () => {
    const nodes = [node("me"), node("spouse"), node("kid")];
    const edges = [partneredWith("me", "spouse"), parentOf("me", "kid"), parentOf("spouse", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const me = placedFor(l, "me");
    const sp = placedFor(l, "spouse");
    const kid = placedFor(l, "kid");
    expect(kid.x).toBeCloseTo((me.x + sp.x) / 2, 5);
  });

  it("groups siblings under shared parents and centers the group on the parent", () => {
    const nodes = [node("dad"), node("a"), node("b")];
    const edges = [parentOf("dad", "a"), parentOf("dad", "b")];
    const l = computeTreeLayout(input({ rootPersonId: "dad", nodes, edges }));
    const dad = placedFor(l, "dad");
    const a = placedFor(l, "a");
    const b = placedFor(l, "b");
    // both drawn one generation down, side by side, centered on dad.
    expect(a.generation).toBe(1);
    expect(b.generation).toBe(1);
    expect((a.x + b.x) / 2).toBeCloseTo(dad.x, 5);
  });

  it("keeps partners adjacent even when each has their OWN drawn parents (in-laws, regression)", () => {
    // me+spouse both at gen 0; me's parents mom/dad and spouse's parents smom/sdad
    // are all drawn at gen -1 as two separate unions. me & spouse must stay
    // adjacent (one COL_STEP apart), not split to sit over their own parents.
    const nodes = [
      node("me"),
      node("spouse"),
      node("mom"),
      node("dad"),
      node("smom"),
      node("sdad"),
    ];
    const edges = [
      partneredWith("me", "spouse"),
      partneredWith("mom", "dad"),
      partneredWith("smom", "sdad"),
      parentOf("mom", "me"),
      parentOf("dad", "me"),
      parentOf("smom", "spouse"),
      parentOf("sdad", "spouse"),
    ];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const me = placedFor(l, "me");
    const spouse = placedFor(l, "spouse");
    expect(me.y).toBe(spouse.y);
    // Adjacent: exactly one column-step apart, nobody between them.
    expect(Math.abs(me.x - spouse.x)).toBeCloseTo(160, 5); // COL_STEP = NODE_W(120)+H_GAP(40)
    const between = l.placed.filter(
      (n) => n.generation === 0 && n.x > Math.min(me.x, spouse.x) && n.x < Math.max(me.x, spouse.x),
    );
    expect(between).toHaveLength(0);
  });

  it("emits descent connectors for each parent→child edge drawn", () => {
    const nodes = [node("me"), node("kid")];
    const edges = [parentOf("me", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(l.connectors.filter((c) => c.kind === "descent").length).toBeGreaterThan(0);
    for (const c of l.connectors) expect(typeof c.d).toBe("string");
  });
});

describe("computeTreeLayout — bounded windowing + expansion reveal", () => {
  it("omits generations beyond ±2 of root by default", () => {
    // me -> ... 3 up: g-3 great-great grandparent
    const nodes = [node("me"), node("p1"), node("p2"), node("p3")];
    const edges = [parentOf("p1", "me"), parentOf("p2", "p1"), parentOf("p3", "p2")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(l.placed.some((n) => n.personId === "p2")).toBe(true); // g-2 in window
    expect(l.placed.some((n) => n.personId === "p3")).toBe(false); // g-3 out
  });

  it("reveals a beyond-window parent only when expandedParents includes the boundary node", () => {
    const nodes = [node("me"), node("p1"), node("p2"), node("p3")];
    const edges = [parentOf("p1", "me"), parentOf("p2", "p1"), parentOf("p3", "p2")];
    // Expanding p2's parents should reveal p3 (g-3).
    const l = computeTreeLayout(
      input({ rootPersonId: "me", nodes, edges, expansion: expansion({ expandedParents: new Set(["p2"]) }) }),
    );
    expect(l.placed.some((n) => n.personId === "p3")).toBe(true);
    expect(placedFor(l, "p3").generation).toBe(-3);
  });

  it("keeps a revealed beyond-window node's partner as a union (regression)", () => {
    // me -> p1 (g-1) -> p2 (g-2 boundary) -> p3 (g-3), and p3 is partnered with p3b (g-3).
    // Expanding p2's parents must draw BOTH p3 and its partner p3b as a union.
    const nodes = [node("me"), node("p1"), node("p2"), node("p3"), node("p3b")];
    const edges = [
      parentOf("p1", "me"),
      parentOf("p2", "p1"),
      parentOf("p3", "p2"),
      partneredWith("p3", "p3b"),
    ];
    const l = computeTreeLayout(
      input({ rootPersonId: "me", nodes, edges, expansion: expansion({ expandedParents: new Set(["p2"]) }) }),
    );
    expect(l.placed.some((n) => n.personId === "p3")).toBe(true);
    expect(l.placed.some((n) => n.personId === "p3b")).toBe(true);
    expect(placedFor(l, "p3b").generation).toBe(-3);
    expect(l.unions.some((u) => (u.aPersonId === "p3" && u.bPersonId === "p3b") || (u.aPersonId === "p3b" && u.bPersonId === "p3"))).toBe(true);
  });

  it("collapsedGenerations hides an entire level", () => {
    const nodes = [node("me"), node("mom"), node("kid")];
    const edges = [parentOf("mom", "me"), parentOf("me", "kid")];
    const l = computeTreeLayout(
      input({ rootPersonId: "me", nodes, edges, expansion: expansion({ collapsedGenerations: new Set([-1]) }) }),
    );
    expect(l.placed.some((n) => n.personId === "mom")).toBe(false);
    expect(l.placed.some((n) => n.personId === "me")).toBe(true);
    expect(l.placed.some((n) => n.personId === "kid")).toBe(true);
  });

  it("keeps a collapse-generation affordance for a collapsed level so it is reversible (regression)", () => {
    const nodes = [node("me"), node("mom"), node("kid")];
    const edges = [parentOf("mom", "me"), parentOf("me", "kid")];
    const l = computeTreeLayout(
      input({ rootPersonId: "me", nodes, edges, expansion: expansion({ collapsedGenerations: new Set([-1]) }) }),
    );
    // Even though gen -1 draws no nodes, its collapse affordance must remain (the
    // only vehicle to toggle the level back on) and sit at a non-negative y.
    const a = l.affordances.find((x) => x.kind === "collapse-generation" && x.targetId === "-1");
    expect(a).toBeTruthy();
    expect(a!.y).toBeGreaterThanOrEqual(0);
  });

  it("does NOT emit an inert expand caret toward a collapsed generation (regression)", () => {
    // me's parent mom is loaded but its generation (-1) is collapsed. An
    // expand-parents caret on me would be inert (collapse-generation is the
    // control), so it must not be emitted.
    const nodes = [node("me"), node("mom")];
    const edges = [parentOf("mom", "me")];
    const l = computeTreeLayout(
      input({ rootPersonId: "me", nodes, edges, expansion: expansion({ collapsedGenerations: new Set([-1]) }) }),
    );
    expect(l.affordances.some((x) => x.kind === "expand-parents" && x.targetId === "me")).toBe(false);
    expect(l.affordances.some((x) => x.kind === "collapse-generation" && x.targetId === "-1")).toBe(true);
  });
});

describe("computeTreeLayout — affordances", () => {
  it("emits expand-parents caret with requiresFetch=false when parents are loaded but not drawn", () => {
    // p2 is at the window boundary (g-2). It has a loaded parent p3 (g-3) not drawn.
    const nodes = [node("me"), node("p1"), node("p2"), node("p3")];
    const edges = [parentOf("p1", "me"), parentOf("p2", "p1"), parentOf("p3", "p2")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const a = l.affordances.find((x) => x.kind === "expand-parents" && x.targetId === "p2");
    expect(a).toBeTruthy();
    expect(a!.requiresFetch).toBe(false);
  });

  it("emits expand-parents caret with requiresFetch=true when node.hasHiddenParents (kin not loaded)", () => {
    const nodes = [node("me", { hasHiddenParents: true })];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    const a = l.affordances.find((x) => x.kind === "expand-parents" && x.targetId === "me");
    expect(a).toBeTruthy();
    expect(a!.requiresFetch).toBe(true);
  });

  it("sets requiresFetch=true when a node has BOTH a loaded-undrawn parent and hasHiddenParents (regression)", () => {
    // Blended family: `me` has a loaded step-parent `step` (undrawn because
    // collapsed) AND a still-unfetched biological parent (hasHiddenParents).
    // The caret must require a fetch — the client can't reach the bio parent
    // by a pure client-side reveal.
    const nodes = [node("me", { hasHiddenParents: true }), node("step")];
    const edges = [parentOf("step", "me")];
    const l = computeTreeLayout(
      input({
        rootPersonId: "me",
        nodes,
        edges,
        expansion: expansion({ collapsedGenerations: new Set([-1]) }),
      }),
    );
    const a = l.affordances.find((x) => x.kind === "expand-parents" && x.targetId === "me");
    expect(a).toBeTruthy();
    expect(a!.requiresFetch).toBe(true);
  });

  it("emits expand-children caret with requiresFetch=true when node.hasHiddenChildren", () => {
    const nodes = [node("me", { hasHiddenChildren: true })];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    const a = l.affordances.find((x) => x.kind === "expand-children" && x.targetId === "me");
    expect(a).toBeTruthy();
    expect(a!.requiresFetch).toBe(true);
  });

  it("does NOT emit an expand caret when all kin of that direction are already drawn", () => {
    const nodes = [node("me"), node("kid")];
    const edges = [parentOf("me", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(l.affordances.some((x) => x.kind === "expand-children" && x.targetId === "me")).toBe(false);
  });

  it("emits one collapse-generation affordance per drawn generation", () => {
    const nodes = [node("me"), node("mom"), node("kid")];
    const edges = [parentOf("mom", "me"), parentOf("me", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    const collapses = l.affordances.filter((x) => x.kind === "collapse-generation");
    // generations drawn: -1, 0, 1
    expect(collapses).toHaveLength(3);
    expect(new Set(collapses.map((c) => c.targetId))).toEqual(new Set(["-1", "0", "1"]));
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
    // gp -> a, b ; a -> c1 ; b -> c2 . Root gp. c1 & c2 are cousins sharing gp.
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
    // Each person appears exactly once.
    expect(l.placed.map((n) => n.personId).sort()).toEqual(["a", "b", "c1", "c2", "gp"]);
  });
});

describe("computeTreeLayout — multiple partners", () => {
  it("places a node's two partners side by side as separate unions", () => {
    // me partnered with x and y (serial partners). Both at gen 0.
    const nodes = [node("me"), node("x"), node("y")];
    const edges = [partneredWith("me", "x"), partneredWith("me", "y")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(placedFor(l, "x").generation).toBe(0);
    expect(placedFor(l, "y").generation).toBe(0);
    expect(l.unions.length).toBe(2);
  });
});

describe("computeTreeLayout — anonymous bridge", () => {
  it("places an anonymous (displayName=null) node like any other", () => {
    const nodes = [node("me"), node("bridge", { displayName: null, identified: false }), node("gp")];
    // bridge is my parent, gp is bridge's parent.
    const edges = [parentOf("bridge", "me"), parentOf("gp", "bridge")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    expect(placedFor(l, "bridge").generation).toBe(-1);
    expect(placedFor(l, "bridge").node.displayName).toBeNull();
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

  it("bounds enclose every affordance too, incl. a collapsed row below all drawn nodes (regression)", () => {
    // grandkid (gen 2) is in-window but its generation is collapsed. Its
    // collapse-generation affordance sits a row below the last drawn node (kid,
    // gen 1) and must still fall inside bounds.
    const nodes = [node("me"), node("kid"), node("grandkid")];
    const edges = [parentOf("me", "kid"), parentOf("kid", "grandkid")];
    const l = computeTreeLayout(
      input({ rootPersonId: "me", nodes, edges, expansion: expansion({ collapsedGenerations: new Set([2]) }) }),
    );
    const a = l.affordances.find((x) => x.kind === "collapse-generation" && x.targetId === "2");
    expect(a).toBeTruthy();
    for (const af of l.affordances) {
      expect(af.x).toBeGreaterThanOrEqual(0);
      expect(af.y).toBeGreaterThanOrEqual(0);
      expect(af.x).toBeLessThanOrEqual(l.bounds.width);
      expect(af.y).toBeLessThanOrEqual(l.bounds.height);
    }
  });
});
