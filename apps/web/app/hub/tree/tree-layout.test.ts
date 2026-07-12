// Pure unit tests for computeTreeLayout — no DB, no React. TDD-first per spec §6/§10.
import { describe, expect, it } from "vitest";
import type { ResolvedKinshipEdge, TreeNode } from "@chronicle/core";

import {
  EMPTY_EXPANSION,
  type ExpansionState,
  NODE_H,
  computeTreeLayout,
  coupleKey,
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
    collapsedAncestors: new Set(),
    collapsedDescendants: new Set(),
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
// Task-2 caret redesign fixtures & helpers.
// ---------------------------------------------------------------------------

/** placedOf: alias for placedFor (matches the caret-test naming). */
const placedOf = placedFor;

/** Collapse a node's ancestors. */
function collapseAncestors(id: string): ExpansionState {
  return expansion({ collapsedAncestors: new Set([id]) });
}

/** Does a union join this exact (unordered) couple? */
function sameCouple(u: { aPersonId: string; bPersonId: string }, a: string, b: string): boolean {
  return (u.aPersonId === a && u.bPersonId === b) || (u.aPersonId === b && u.bPersonId === a);
}

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

/** root partnered with spouse; root+spouse -> child. */
function fixtureCoupleWithChild(): LayoutInput {
  const nodes = [node("root"), node("spouse"), node("child")];
  const edges = [
    partneredWith("root", "spouse"),
    parentOf("root", "child"),
    parentOf("spouse", "child"),
  ];
  return input({ rootPersonId: "root", nodes, edges });
}

/** root (no drawn partner) -> child. */
function fixtureLoneParentWithChild(): LayoutInput {
  const nodes = [node("root"), node("child")];
  const edges = [parentOf("root", "child")];
  return input({ rootPersonId: "root", nodes, edges });
}

/** root -> leaf, where leaf has hidden (unloaded) children at the boundary. */
function fixtureBoundaryChildren(): LayoutInput {
  const nodes = [node("root"), node("leaf", { hasHiddenChildren: true })];
  const edges = [parentOf("root", "leaf")];
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
});

describe("computeTreeLayout — per-box carets (ancestors/descendants)", () => {
  it("emits an ancestor caret on the TOP of a node that has parents, expanded when parents are drawn", () => {
    const layout = computeTreeLayout(fixtureThreeGen());
    const root = placedOf(layout, "root");
    const anc = layout.affordances.find((a) => a.kind === "ancestors" && a.targetId === "root");
    expect(anc).toBeTruthy();
    expect(anc!.expanded).toBe(true);
    expect(anc!.y).toBeCloseTo(root.y - NODE_H / 2);
  });

  it("collapsing a node's ancestors removes the ancestor subtree and flips the caret to collapsed", () => {
    const base = fixtureThreeGen();
    const layout = computeTreeLayout({ ...base, expansion: collapseAncestors("root") });
    expect(layout.placed.find((p) => p.personId === "parent")).toBeUndefined();
    expect(layout.placed.find((p) => p.personId === "gp")).toBeUndefined();
    const anc = layout.affordances.find((a) => a.kind === "ancestors" && a.targetId === "root");
    expect(anc!.expanded).toBe(false);
  });

  it("emits exactly ONE descendant caret for a couple, on the union edge", () => {
    const layout = computeTreeLayout(fixtureCoupleWithChild());
    const desc = layout.affordances.filter((a) => a.kind === "descendants");
    expect(desc).toHaveLength(1);
    const union = layout.unions.find((u) => sameCouple(u, "root", "spouse"))!;
    expect(desc[0]!.x).toBeCloseTo(union.x);
    expect(desc[0]!.y).toBeGreaterThan(union.y);
  });

  it("emits the descendant caret on the node when there is no drawn partner", () => {
    const layout = computeTreeLayout(fixtureLoneParentWithChild());
    const desc = layout.affordances.filter((a) => a.kind === "descendants");
    expect(desc).toHaveLength(1);
    // Sole occupant of the couple: targetId is coupleKey(root) == "root".
    expect(desc[0]!.targetId).toBe(coupleKey("root"));
    expect(desc[0]!.fetchPersonId).toBe("root");
  });

  it("a boundary node (hasHiddenChildren) emits a collapsed descendant caret needing a fetch", () => {
    const layout = computeTreeLayout(fixtureBoundaryChildren());
    const desc = layout.affordances.find((a) => a.kind === "descendants" && a.fetchPersonId === "leaf")!;
    expect(desc).toBeTruthy();
    expect(desc.expanded).toBe(false);
    expect(desc.requiresFetch).toBe(true);
  });

  it("emits NO collapse-generation affordances", () => {
    const layout = computeTreeLayout(fixtureThreeGen());
    expect(layout.affordances.some((a) => (a as { kind: string }).kind === "collapse-generation")).toBe(false);
  });

  it("ancestor caret requiresFetch=true when node.hasHiddenParents and none are loaded", () => {
    const nodes = [node("me", { hasHiddenParents: true })];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes }));
    const a = l.affordances.find((x) => x.kind === "ancestors" && x.targetId === "me");
    expect(a).toBeTruthy();
    expect(a!.expanded).toBe(false);
    expect(a!.requiresFetch).toBe(true);
  });

  it("does NOT emit a descendant caret when a node has no children and none hidden", () => {
    const nodes = [node("me"), node("kid")];
    const edges = [parentOf("me", "kid")];
    const l = computeTreeLayout(input({ rootPersonId: "me", nodes, edges }));
    // kid has no children => no descendant caret targeting kid.
    expect(l.affordances.some((x) => x.kind === "descendants" && x.fetchPersonId === "kid")).toBe(false);
  });

  it("collapsing a couple's descendants removes the descendant subtree", () => {
    const base = fixtureCoupleWithChild();
    const l = computeTreeLayout({
      ...base,
      expansion: expansion({ collapsedDescendants: new Set([coupleKey("root", "spouse")]) }),
    });
    expect(l.placed.find((p) => p.personId === "child")).toBeUndefined();
    const desc = l.affordances.find((a) => a.kind === "descendants");
    expect(desc!.expanded).toBe(false);
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

  it("bounds enclose every affordance glyph too", () => {
    const l = computeTreeLayout(fixtureThreeGen());
    for (const af of l.affordances) {
      expect(af.x).toBeGreaterThanOrEqual(0);
      expect(af.y).toBeGreaterThanOrEqual(0);
      expect(af.x).toBeLessThanOrEqual(l.bounds.width);
      expect(af.y).toBeLessThanOrEqual(l.bounds.height);
    }
  });
});
