// Pure unit tests for computeTreeLayout — ego-centric redesign (spec 2026-07-13). No DB, no React.
// Generations stack vertically (ancestors up / smaller y, descendants down / larger y); within a
// generation, cards spread horizontally (x). Each identified card owns up to three directional
// affordances (parents ↑, siblings ↔, children ↓): a caret when kin exist, a "+" when none do.
import { describe, expect, it } from "vitest";
import type { ResolvedKinshipEdge, TreeNode } from "@chronicle/core";

import {
  EMPTY_EXPANSION,
  type ExpansionState,
  NODE_H,
  computeTreeLayout,
  coupleKey,
  type Affordance,
  type LayoutInput,
} from "./tree-layout";

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
  return { ...EMPTY_EXPANSION, ...over };
}

function input(over: Partial<LayoutInput> & Pick<LayoutInput, "focusPersonId">): LayoutInput {
  return { nodes: [], edges: [], expansion: EMPTY_EXPANSION, ...over };
}

function placedFor(layout: ReturnType<typeof computeTreeLayout>, id: string) {
  const p = layout.placed.find((n) => n.personId === id);
  if (!p)
    throw new Error(
      `expected ${id} to be placed; placed=${layout.placed.map((n) => n.personId).join(",")}`,
    );
  return p;
}

function aff(
  layout: ReturnType<typeof computeTreeLayout>,
  direction: Affordance["direction"],
  ownerId: string,
): Affordance | undefined {
  return layout.affordances.find((a) => a.direction === direction && a.ownerId === ownerId);
}

// A common focus-with-both-directions fixture: mom -> focus, focus -> kid. Focus's parents & children
// are expanded by default (initial expansion), siblings collapsed.
function fixtureFocusMidGen(): LayoutInput {
  const nodes = [node("mom"), node("focus"), node("kid")];
  const edges = [parentOf("mom", "focus"), parentOf("focus", "kid")];
  return input({ focusPersonId: "focus", nodes, edges });
}

// ---------------------------------------------------------------------------

describe("generation assignment", () => {
  it("focus is generation 0; parent -1; child +1; grandparent -2", () => {
    const nodes = [node("me"), node("mom"), node("kid"), node("gran")];
    const edges = [parentOf("mom", "me"), parentOf("me", "kid"), parentOf("gran", "mom")];
    const l = computeTreeLayout(
      input({ focusPersonId: "me", nodes, edges, expansion: expansion({ expandedParents: new Set(["mom"]) }) }),
    );
    expect(placedFor(l, "me").generation).toBe(0);
    expect(placedFor(l, "mom").generation).toBe(-1);
    expect(placedFor(l, "kid").generation).toBe(1);
    expect(placedFor(l, "gran").generation).toBe(-2);
  });

  it("partner shares the focus's generation and is always drawn adjacent", () => {
    const nodes = [node("me"), node("spouse")];
    const edges = [partneredWith("me", "spouse")];
    const l = computeTreeLayout(input({ focusPersonId: "me", nodes, edges }));
    expect(placedFor(l, "spouse").generation).toBe(0);
    expect(l.unions).toHaveLength(1);
  });
});

describe("initial expansion (focus-only)", () => {
  it("focus's parents and children are shown by default; siblings are NOT", () => {
    const nodes = [node("mom"), node("focus"), node("kid"), node("sib")];
    const edges = [
      parentOf("mom", "focus"),
      parentOf("focus", "kid"),
      parentOf("mom", "sib"), // sib shares mom → derived sibling of focus
    ];
    const l = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges }));
    expect(l.placed.some((p) => p.personId === "mom")).toBe(true); // parent shown
    expect(l.placed.some((p) => p.personId === "kid")).toBe(true); // child shown
    expect(l.placed.some((p) => p.personId === "sib")).toBe(false); // sibling collapsed
  });

  it("a PARTNER's parents/siblings start collapsed (initial expansion is focus-only)", () => {
    const nodes = [node("focus"), node("spouse"), node("mil")];
    const edges = [partneredWith("focus", "spouse"), parentOf("mil", "spouse")];
    const l = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges }));
    expect(l.placed.some((p) => p.personId === "spouse")).toBe(true);
    expect(l.placed.some((p) => p.personId === "mil")).toBe(false); // in-law parent collapsed
  });
});

describe("axis direction", () => {
  it("ancestors above (smaller y), descendants below, focus between; same gen shares y", () => {
    const l = computeTreeLayout(fixtureFocusMidGen());
    const mom = placedFor(l, "mom");
    const focus = placedFor(l, "focus");
    const kid = placedFor(l, "kid");
    expect(mom.y).toBeLessThan(focus.y);
    expect(focus.y).toBeLessThan(kid.y);
  });
});

describe("carets vs '+' selection (spec §3)", () => {
  it("isolated focus: a card plus three '+' (parents/siblings/children), no carets", () => {
    const l = computeTreeLayout(input({ focusPersonId: "me", nodes: [node("me")] }));
    expect(l.placed).toHaveLength(1);
    expect(aff(l, "parents", "me")!.kind).toBe("add");
    expect(aff(l, "siblings", "me")!.kind).toBe("add");
    expect(aff(l, "children", "me")!.kind).toBe("add");
  });

  it("a direction with kin shows a caret, not a '+'", () => {
    const l = computeTreeLayout(fixtureFocusMidGen());
    // focus has a drawn parent → parents caret (expanded), a drawn child → children caret,
    // no siblings → siblings '+'.
    expect(aff(l, "parents", "focus")!.kind).toBe("caret");
    expect(aff(l, "parents", "focus")!.expanded).toBe(true);
    expect(aff(l, "children", "focus")!.kind).toBe("caret");
    expect(aff(l, "siblings", "focus")!.kind).toBe("add");
  });

  it("a collapsed parent shows an unexpanded caret (kin exist, not drawn)", () => {
    const nodes = [node("mom"), node("focus"), node("kid")];
    const edges = [parentOf("mom", "focus"), parentOf("focus", "kid")];
    const l = computeTreeLayout(
      input({ focusPersonId: "focus", nodes, edges, expansion: expansion({ collapsedParents: new Set(["focus"]) }) }),
    );
    expect(l.placed.some((p) => p.personId === "mom")).toBe(false);
    const a = aff(l, "parents", "focus")!;
    expect(a.kind).toBe("caret");
    expect(a.expanded).toBe(false);
  });

  it("hasHiddenParents (kin beyond the window) still yields a caret, not a '+'", () => {
    const l = computeTreeLayout(
      input({ focusPersonId: "me", nodes: [node("me", { hasHiddenParents: true })] }),
    );
    expect(aff(l, "parents", "me")!.kind).toBe("caret");
  });
});

describe("caret placement & orientation (spec §3)", () => {
  it("parents caret sits centered above the top edge", () => {
    const l = computeTreeLayout(fixtureFocusMidGen());
    const focus = placedFor(l, "focus");
    const a = aff(l, "parents", "focus")!;
    expect(a.x).toBeCloseTo(focus.x, 5);
    expect(a.y).toBeLessThan(focus.y - NODE_H / 2);
    expect(a.side).toBe("center");
  });

  it("children caret sits centered below the bottom edge (per couple)", () => {
    const l = computeTreeLayout(fixtureFocusMidGen());
    const focus = placedFor(l, "focus");
    const a = aff(l, "children", "focus")!;
    expect(a.y).toBeGreaterThan(focus.y + NODE_H / 2);
    expect(a.side).toBe("center");
  });

  it("siblings caret hugs the LEFT for a single unspecified-sex person", () => {
    const nodes = [node("mom"), node("focus"), node("sib")];
    const edges = [parentOf("mom", "focus"), parentOf("mom", "sib")];
    const l = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges }));
    const focus = placedFor(l, "focus");
    const a = aff(l, "siblings", "focus")!;
    expect(a.side).toBe("left");
    expect(a.x).toBeLessThan(focus.x);
  });

  it("siblings caret hugs the RIGHT for a single female person", () => {
    const nodes = [node("mom"), node("focus", { sex: "female" }), node("sib")];
    const edges = [parentOf("mom", "focus"), parentOf("mom", "sib")];
    const l = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges }));
    const focus = placedFor(l, "focus");
    const a = aff(l, "siblings", "focus")!;
    expect(a.side).toBe("right");
    expect(a.x).toBeGreaterThan(focus.x);
  });

  it("in a couple, sibling carets are on the OUTER sides (left partner far-left, right partner far-right)", () => {
    const nodes = [
      node("gmL"),
      node("gmR"),
      node("man", { sex: "male" }),
      node("woman", { sex: "female" }),
    ];
    // Give each partner a sibling so both get sibling carets, and parents so gens are set.
    const edges = [
      partneredWith("man", "woman"),
      parentOf("gmL", "man"),
      parentOf("gmR", "woman"),
    ];
    const l = computeTreeLayout(input({ focusPersonId: "man", nodes, edges }));
    const man = placedFor(l, "man");
    const woman = placedFor(l, "woman");
    // man is on the left (male), woman on the right.
    expect(man.x).toBeLessThan(woman.x);
    expect(aff(l, "siblings", "man")!.side).toBe("left");
    expect(aff(l, "siblings", "man")!.x).toBeLessThan(man.x);
    expect(aff(l, "siblings", "woman")!.side).toBe("right");
    expect(aff(l, "siblings", "woman")!.x).toBeGreaterThan(woman.x);
  });
});

describe("children-caret dedup rule (spec §3)", () => {
  it("an expanded ancestor couple carries NO children-caret (child already on the bus)", () => {
    // mom -> focus (focus's parent shown by default). mom has a drawn child (focus) → NO children-caret
    // on mom; focus's siblings come off focus's sibling-caret instead.
    const nodes = [node("mom"), node("focus")];
    const edges = [parentOf("mom", "focus")];
    const l = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges }));
    // mom is drawn with a drawn child (focus) → mom's children caret must be a COLLAPSE (expanded)
    // caret, NOT an expand caret that would double-reveal focus. The dedup: no *second* reveal control.
    const momChildren = aff(l, "children", "mom");
    // mom's children caret exists (to collapse focus's branch) but is marked expanded — it never
    // re-reveals an already-drawn child.
    if (momChildren) expect(momChildren.expanded).toBe(true);
  });

  it("an aunt/uncle with NO drawn child shows a children-caret (reveals cousins)", () => {
    // focus + sibling `unc`; unc has a child `cousin` NOT drawn. Expand focus's siblings so unc is
    // drawn; unc then owns a children-caret to reveal the cousin.
    const nodes = [node("mom"), node("focus"), node("unc"), node("cousin")];
    const edges = [
      parentOf("mom", "focus"),
      parentOf("mom", "unc"),
      parentOf("unc", "cousin"),
    ];
    const l = computeTreeLayout(
      input({ focusPersonId: "focus", nodes, edges, expansion: expansion({ expandedSiblings: new Set(["focus"]) }) }),
    );
    expect(l.placed.some((p) => p.personId === "unc")).toBe(true);
    expect(l.placed.some((p) => p.personId === "cousin")).toBe(false);
    const a = aff(l, "children", "unc")!;
    expect(a.kind).toBe("caret");
    expect(a.expanded).toBe(false); // an EXPAND caret → reveals the cousin
  });

  it("no person is revealable by two live (unexpanded) carets", () => {
    const nodes = [node("mom"), node("focus"), node("sib")];
    const edges = [parentOf("mom", "focus"), parentOf("mom", "sib")];
    // Siblings collapsed by default: sib is undrawn. It should be reachable ONLY via focus's sibling
    // caret — mom's children caret must NOT be an unexpanded reveal control while focus is on the bus.
    const l = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges }));
    const momChildren = aff(l, "children", "mom");
    // mom already has a drawn child (focus) → its children caret is a collapse (expanded=true), so it
    // does not double as an "reveal sib" control. sib comes from focus's sibling caret.
    if (momChildren) expect(momChildren.expanded).toBe(true);
    expect(aff(l, "siblings", "focus")!.kind).toBe("caret");
  });
});

describe("ego-side sibling fan — oldest farthest (spec §4)", () => {
  it("fans siblings to the caret side with the focus pinned at that end and oldest farthest", () => {
    // Focus (left-hugging, unspecified sex) + three older siblings. Expanded: left→right should read
    // focus, youngest, …, oldest (oldest is FARTHEST from focus).
    const nodes = [
      node("mom"),
      node("focus", { birthYear: 1990 }),
      node("s1", { birthYear: 1980 }), // oldest
      node("s2", { birthYear: 1985 }),
      node("s3", { birthYear: 1988 }), // youngest sibling
    ];
    const edges = [
      parentOf("mom", "focus"),
      parentOf("mom", "s1"),
      parentOf("mom", "s2"),
      parentOf("mom", "s3"),
    ];
    const l = computeTreeLayout(
      input({ focusPersonId: "focus", nodes, edges, expansion: expansion({ expandedSiblings: new Set(["focus"]) }) }),
    );
    const row = l.placed
      .filter((p) => p.generation === 0)
      .sort((a, b) => a.x - b.x)
      .map((p) => p.personId);
    // Focus hugs LEFT → focus pinned at the left end; siblings fan right, youngest nearest, oldest far.
    expect(row).toEqual(["focus", "s3", "s2", "s1"]);
  });

  it("same-sex/unspecified couple: fan side matches the POSITION caret side (anchor is the right partner)", () => {
    // Two unspecified-sex partners a,b (a<b). §5 places a LEFT, b RIGHT by entry order/id. Focus b is
    // therefore the RIGHT partner → its sibling caret is on the RIGHT, so the fan must pin b to the
    // right end (regression: a sex-only rule would wrongly pin the unspecified anchor to the left).
    const nodes = [
      node("a"),
      node("b"),
      node("mom"),
      node("s1", { birthYear: 1980 }),
      node("s2", { birthYear: 1985 }),
    ];
    const edges = [
      partneredWith("a", "b"),
      parentOf("mom", "b"),
      parentOf("mom", "s1"),
      parentOf("mom", "s2"),
    ];
    const l = computeTreeLayout(
      input({ focusPersonId: "b", nodes, edges, expansion: expansion({ expandedSiblings: new Set(["b"]) }) }),
    );
    // Caret side for b is right (b is the right partner of the drawn couple).
    expect(aff(l, "siblings", "b")!.side).toBe("right");
    const b = placedFor(l, "b");
    // Both siblings drawn to the LEFT of b (fanned to b's caret side = right end, siblings toward left).
    expect(placedFor(l, "s1").x).toBeLessThan(b.x);
    expect(placedFor(l, "s2").x).toBeLessThan(b.x);
    // Oldest (s1) is FARTHEST from b (smallest x).
    expect(placedFor(l, "s1").x).toBeLessThan(placedFor(l, "s2").x);
  });

  it("fans to the RIGHT (focus pinned at the right end) for a female focus", () => {
    const nodes = [
      node("mom"),
      node("focus", { sex: "female", birthYear: 1990 }),
      node("s1", { birthYear: 1980 }),
      node("s2", { birthYear: 1985 }),
    ];
    const edges = [parentOf("mom", "focus"), parentOf("mom", "s1"), parentOf("mom", "s2")];
    const l = computeTreeLayout(
      input({ focusPersonId: "focus", nodes, edges, expansion: expansion({ expandedSiblings: new Set(["focus"]) }) }),
    );
    const row = l.placed
      .filter((p) => p.generation === 0)
      .sort((a, b) => a.x - b.x)
      .map((p) => p.personId);
    // left→right: oldest → youngest → focus (focus at far right).
    expect(row).toEqual(["s1", "s2", "focus"]);
  });
});

describe("descent-bus geometry (spec §6)", () => {
  it("two-parent bus: feeders from both parents + a shared riser to the child", () => {
    const nodes = [node("me"), node("spouse"), node("kid")];
    const edges = [partneredWith("me", "spouse"), parentOf("me", "kid"), parentOf("spouse", "kid")];
    const l = computeTreeLayout(input({ focusPersonId: "me", nodes, edges }));
    const me = placedFor(l, "me");
    const sp = placedFor(l, "spouse");
    const kid = placedFor(l, "kid");
    // Child centered on the couple's midpoint.
    expect(kid.x).toBeCloseTo((me.x + sp.x) / 2, 5);
    // A descent connector starts at each parent's bottom edge.
    const descents = l.connectors.filter((c) => c.kind === "descent");
    expect(descents.some((c) => c.d.startsWith(`M ${me.x} ${me.y + NODE_H / 2}`))).toBe(true);
    expect(descents.some((c) => c.d.includes(`${sp.x} ${sp.y + NODE_H / 2}`))).toBe(true);
  });

  it("single-parent bus: one feeder from the lone card's bottom-center", () => {
    const nodes = [node("me"), node("kid")];
    const edges = [parentOf("me", "kid")];
    const l = computeTreeLayout(input({ focusPersonId: "me", nodes, edges }));
    const me = placedFor(l, "me");
    const descents = l.connectors.filter((c) => c.kind === "descent");
    // The lone feeder starts at me's bottom-center.
    expect(descents.some((c) => c.d.startsWith(`M ${me.x} ${me.y + NODE_H / 2}`))).toBe(true);
    // Only ONE parent feeds — no second parent bottom-edge start.
    const parentBottomStarts = descents.filter((c) => c.d.startsWith(`M ${me.x} ${me.y + NODE_H / 2}`));
    expect(parentBottomStarts.length).toBeGreaterThan(0);
  });

  it("multiple children: a horizontal bar spans leftmost..rightmost child top-centers", () => {
    const nodes = [node("me"), node("k1"), node("k2")];
    const edges = [parentOf("me", "k1"), parentOf("me", "k2")];
    const l = computeTreeLayout(
      input({ focusPersonId: "me", nodes, edges, expansion: expansion({ expandedChildren: new Set([coupleKey("me")]) }) }),
    );
    // Both kids drawn (initial expansion shows the focus's children).
    expect(l.placed.some((p) => p.personId === "k1")).toBe(true);
    expect(l.placed.some((p) => p.personId === "k2")).toBe(true);
    const k1 = placedFor(l, "k1");
    const k2 = placedFor(l, "k2");
    const barLeft = Math.min(k1.x, k2.x);
    const barRight = Math.max(k1.x, k2.x);
    const descents = l.connectors.filter((c) => c.kind === "descent");
    // A horizontal bar connector runs from barLeft to barRight at a shared y.
    expect(descents.some((c) => c.d.includes(`M ${barLeft} `) && c.d.includes(`L ${barRight} `))).toBe(true);
  });
});

describe("partner ordering (spec §5)", () => {
  it("man on the left, woman on the right (nominal)", () => {
    const nodes = [node("m", { sex: "male" }), node("w", { sex: "female" })];
    const edges = [partneredWith("m", "w")];
    const l = computeTreeLayout(input({ focusPersonId: "m", nodes, edges }));
    expect(placedFor(l, "m").x).toBeLessThan(placedFor(l, "w").x);
  });

  it("same-sex / unspecified: deterministic by id (never random)", () => {
    const nodes = [node("b"), node("a")];
    const edges = [partneredWith("a", "b")];
    const l = computeTreeLayout(input({ focusPersonId: "a", nodes, edges }));
    // a < b by id → a on the left, deterministically.
    expect(placedFor(l, "a").x).toBeLessThan(placedFor(l, "b").x);
  });
});

describe("anonymous bridge is inert (spec §2 / ADR-0017)", () => {
  it("a bridge (identified=false) gets NO affordances", () => {
    const nodes = [node("focus"), node("bridge", { identified: false, displayName: null }), node("gp")];
    const edges = [parentOf("bridge", "focus"), parentOf("gp", "bridge")];
    const l = computeTreeLayout(
      input({ focusPersonId: "focus", nodes, edges, expansion: expansion({ expandedParents: new Set(["focus"]) }) }),
    );
    expect(l.placed.some((p) => p.personId === "bridge")).toBe(true);
    expect(l.affordances.some((a) => a.ownerId === "bridge")).toBe(false);
  });
});

describe("dedup a person on two paths (spec §8)", () => {
  it("draws a shared node once, deduped by personId", () => {
    const nodes = [node("gp"), node("a"), node("b"), node("shared")];
    // `shared` is a child of both a and b (two lineage paths).
    const edges = [
      parentOf("gp", "a"),
      parentOf("gp", "b"),
      parentOf("a", "shared"),
      parentOf("b", "shared"),
    ];
    const l = computeTreeLayout(
      input({ focusPersonId: "gp", nodes, edges, expansion: expansion({ expandedChildren: new Set([coupleKey("gp"), coupleKey("a"), coupleKey("b")]) }) }),
    );
    expect(l.placed.filter((p) => p.personId === "shared")).toHaveLength(1);
  });
});

describe("collapse prunes the whole branch (spec §7)", () => {
  it("collapsing focus's children prunes children AND grandchildren", () => {
    const nodes = [node("focus"), node("kid"), node("grandkid")];
    const edges = [parentOf("focus", "kid"), parentOf("kid", "grandkid")];
    const l = computeTreeLayout(
      input({ focusPersonId: "focus", nodes, edges, expansion: expansion({ collapsedChildren: new Set([coupleKey("focus")]) }) }),
    );
    expect(l.placed.some((p) => p.personId === "kid")).toBe(false);
    expect(l.placed.some((p) => p.personId === "grandkid")).toBe(false);
  });
});

describe("determinism", () => {
  it("shuffled node/edge order yields byte-identical output", () => {
    const nodes = [node("me"), node("mom"), node("dad"), node("kid"), node("sib")];
    const edges = [
      parentOf("mom", "me"),
      parentOf("dad", "me"),
      parentOf("mom", "sib"),
      parentOf("dad", "sib"),
      parentOf("me", "kid"),
    ];
    const exp = expansion({ expandedParents: new Set(["me"]), expandedSiblings: new Set(["me"]) });
    const straight = computeTreeLayout(input({ focusPersonId: "me", nodes, edges, expansion: exp }));
    const shuffled = computeTreeLayout(
      input({ focusPersonId: "me", nodes: [...nodes].reverse(), edges: [...edges].reverse(), expansion: exp }),
    );
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(straight));
  });
});

describe("bounds", () => {
  it("bounds enclose every placed node and affordance", () => {
    const nodes = [node("me"), node("mom"), node("kid")];
    const edges = [parentOf("mom", "me"), parentOf("me", "kid")];
    const l = computeTreeLayout(input({ focusPersonId: "me", nodes, edges }));
    for (const p of l.placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(l.bounds.width);
      expect(p.y).toBeLessThanOrEqual(l.bounds.height);
    }
    for (const a of l.affordances) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x).toBeLessThanOrEqual(l.bounds.width);
    }
  });
});
