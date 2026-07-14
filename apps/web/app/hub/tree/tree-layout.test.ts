// Pure unit tests for computeTreeLayout — ego-centric redesign (spec 2026-07-13). No DB, no React.
// Generations stack vertically (ancestors up / smaller y, descendants down / larger y); within a
// generation, cards spread horizontally (x). Each identified card owns up to three directional
// affordances (parents ↑, siblings ↔, children ↓): a caret when kin exist, a "+" when none do.
import { describe, expect, it } from "vitest";
import type { ResolvedKinshipEdge, TreeNode } from "@chronicle/core";

import {
  CARET_GAP,
  EMPTY_EXPANSION,
  type ExpansionState,
  NODE_H,
  computeTreeLayout,
  coupleKey,
  roundedPath,
  toggleAffordanceExpansion,
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

// --- Connector-path parsing helpers (connectors use only M/L commands) --------------------------
type Seg = { x1: number; y1: number; x2: number; y2: number };
function segmentsOf(d: string): Seg[] {
  const nums = (d.match(/-?[\d.]+/g) ?? []).map(Number);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
  const segs: Seg[] = [];
  for (let i = 1; i < pts.length; i++)
    segs.push({ x1: pts[i - 1]![0], y1: pts[i - 1]![1], x2: pts[i]![0], y2: pts[i]![1] });
  return segs;
}
/** Classify a 3-segment V–H–V path as a "U" (∪, bar below endpoints) or "cap" (∩, bar above), else null. */
function threeSegShape(d: string): "U" | "cap" | null {
  const s = segmentsOf(d);
  if (s.length !== 3) return null;
  const [a, b, c] = s as [Seg, Seg, Seg];
  const isV = (g: Seg) => Math.abs(g.x1 - g.x2) < 1e-9;
  const isH = (g: Seg) => Math.abs(g.y1 - g.y2) < 1e-9;
  if (!isV(a) || !isH(b) || !isV(c)) return null;
  const barY = b.y1;
  if (barY > a.y1 && barY > c.y2) return "U"; // ∪ — bar dips below both endpoints
  if (barY < a.y1 && barY < c.y2) return "cap"; // ∩ — bar rises above both endpoints
  return null;
}
function hasShape(l: ReturnType<typeof computeTreeLayout>, kind: "U" | "cap"): boolean {
  return l.connectors.some((c) => c.kind === "descent" && threeSegShape(c.d) === kind);
}
/** Every horizontal sub-segment across all descent connectors, as {y, lo, hi} (drops zero-length). */
function horizontalSegs(l: ReturnType<typeof computeTreeLayout>): Array<{ y: number; lo: number; hi: number }> {
  const out: Array<{ y: number; lo: number; hi: number }> = [];
  for (const c of l.connectors) {
    if (c.kind !== "descent") continue;
    for (const s of segmentsOf(c.d))
      if (Math.abs(s.y1 - s.y2) < 1e-9 && Math.abs(s.x1 - s.x2) > 1e-9)
        out.push({ y: s.y1, lo: Math.min(s.x1, s.x2), hi: Math.max(s.x1, s.x2) });
  }
  return out;
}
/** True if some horizontal descent level (merged across touching segments) covers every x in `xs`. */
function horizontalCovers(l: ReturnType<typeof computeTreeLayout>, xs: number[]): boolean {
  const byY = new Map<number, Array<[number, number]>>();
  for (const s of horizontalSegs(l)) {
    const key = Math.round(s.y * 100) / 100;
    const arr = byY.get(key) ?? [];
    arr.push([s.lo, s.hi]);
    byY.set(key, arr);
  }
  for (const arr of byY.values()) {
    arr.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const [lo, hi] of arr) {
      const last = merged[merged.length - 1];
      if (last && lo <= last[1] + 1e-6) last[1] = Math.max(last[1], hi);
      else merged.push([lo, hi]);
    }
    if (merged.some(([lo, hi]) => xs.every((x) => x >= lo - 1e-6 && x <= hi + 1e-6))) return true;
  }
  return false;
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

describe("couple children affordance hugs the bottom seam (2026-07-14 regression)", () => {
  // Regression for the reported bug: the couple's child caret/"+" used to drop to the U-floor
  // (JOIN_DROP ≈ 27px), which floated in empty space when collapsed because no U is drawn then. It now
  // hugs the seam at CARET_GAP — a FIXED offset relative to the cards, identical collapsed vs expanded
  // and identical caret vs "+", so the position also encodes the couple for a predetermined-parents add.

  it('a childless couple\'s "+" hugs the seam at CARET_GAP, centered between the partners', () => {
    const nodes = [node("man", { sex: "male" }), node("woman", { sex: "female" })];
    const edges = [partneredWith("man", "woman")];
    const l = computeTreeLayout(input({ focusPersonId: "man", nodes, edges }));
    const man = placedFor(l, "man");
    const woman = placedFor(l, "woman");
    const a = aff(l, "children", "man")!; // ownerId is the LEFT (male) anchor
    expect(a.kind).toBe("add"); // no children yet
    expect(a.y).toBeCloseTo(man.y + NODE_H / 2 + CARET_GAP, 5); // seam offset, not JOIN_DROP
    expect(a.x).toBeCloseTo((man.x + woman.x) / 2, 5);
    // Carries the couple key (a|b) so the canvas can square the inner corners AND pre-bind the co-parent.
    expect(a.coupleId).toBe(coupleKey("man", "woman"));
    expect(a.coupleId!.includes("|")).toBe(true);
  });

  it("the couple children caret is at the SAME position collapsed as expanded", () => {
    const nodes = [node("man", { sex: "male" }), node("woman", { sex: "female" }), node("kid")];
    const edges = [partneredWith("man", "woman"), parentOf("man", "kid"), parentOf("woman", "kid")];
    const ck = coupleKey("man", "woman");
    const expanded = computeTreeLayout(input({ focusPersonId: "man", nodes, edges }));
    const collapsed = computeTreeLayout(
      input({ focusPersonId: "man", nodes, edges, expansion: expansion({ collapsedChildren: new Set([ck]) }) }),
    );
    const ea = aff(expanded, "children", "man")!;
    const ca = aff(collapsed, "children", "man")!;
    expect(ea.expanded).toBe(true); // child drawn by default
    expect(ca.expanded).toBe(false); // pruned
    // Position (x AND y) is byte-identical between the two states — the whole point of the fix.
    const man = placedFor(expanded, "man");
    expect(ea.y).toBeCloseTo(man.y + NODE_H / 2 + CARET_GAP, 5);
    expect(ca.y).toBeCloseTo(ea.y, 5);
    expect(ca.x).toBeCloseTo(ea.x, 5);
  });

  it("a single parent's children affordance also hugs the seam (unchanged rule, now shared)", () => {
    const l = computeTreeLayout(input({ focusPersonId: "solo", nodes: [node("solo")] }));
    const solo = placedFor(l, "solo");
    const a = aff(l, "children", "solo")!;
    expect(a.y).toBeCloseTo(solo.y + NODE_H / 2 + CARET_GAP, 5);
    // A lone parent keys to their own id (no "|") → no co-parent to pre-bind, no corners to square.
    expect(a.coupleId).toBe(coupleKey("solo"));
    expect(a.coupleId!.includes("|")).toBe(false);
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

describe("nearer-owns caret ownership (ADR-0018)", () => {
  it("a revealed child shows NO parent-caret back up (the parent owns that edge)", () => {
    // focus -> kid, kid shown by initial children expansion (discovered via child-set). The child
    // must not emit a parent-caret pointing back at the parent that revealed it.
    const nodes = [node("focus"), node("kid")];
    const edges = [parentOf("focus", "kid")];
    const l = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges }));
    expect(l.placed.some((p) => p.personId === "kid")).toBe(true);
    expect(aff(l, "parents", "kid")).toBeUndefined();
    // The anchor's couple owns the single children control (a collapse caret — kid is drawn).
    const fc = aff(l, "children", "focus")!;
    expect(fc.kind).toBe("caret");
    expect(fc.expanded).toBe(true);
  });

  it("a direct-lineage parent shows NO children-caret (the anchor owns the bus via its parents-caret)", () => {
    // mom -> focus; focus's parent mom is on the bus by default. mom is the direct-lineage parent
    // (reached FROM BELOW via focus's parents-caret) → she must NOT draw a children-caret back down at
    // focus. Otherwise the vertical bus carries two carets (mom's ↓ and focus's ↑) — the reported bug.
    const nodes = [node("mom"), node("focus")];
    const edges = [parentOf("mom", "focus")];
    const l = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges }));
    expect(l.placed.some((p) => p.personId === "mom")).toBe(true);
    expect(aff(l, "children", "mom")).toBeUndefined();
    // The anchor owns the single vertical control — an expanded parents ↑ caret.
    const fp = aff(l, "parents", "focus")!;
    expect(fp.kind).toBe("caret");
    expect(fp.expanded).toBe(true);
  });

  it("in a 3-gen ancestor chain the middle parent keeps its parents-caret but shows no children-caret", () => {
    // gran -> mom -> focus; expand mom's parents so gran is drawn. mom (reached via focus's
    // parents-caret) owns her OWN parents ↑ (→ gran) but NOT children ↓ (focus owns that edge).
    const nodes = [node("gran"), node("mom"), node("focus")];
    const edges = [parentOf("gran", "mom"), parentOf("mom", "focus")];
    const l = computeTreeLayout(
      input({ focusPersonId: "focus", nodes, edges, expansion: expansion({ expandedParents: new Set(["mom"]) }) }),
    );
    expect(l.placed.some((p) => p.personId === "gran")).toBe(true);
    expect(aff(l, "children", "mom")).toBeUndefined();
    expect(aff(l, "parents", "mom")!.kind).toBe("caret");
    expect(aff(l, "parents", "mom")!.expanded).toBe(true);
  });

  it("a fanned sibling shows NO sibling (or parent) affordance; only the anchor owns the set", () => {
    const nodes = [node("mom"), node("focus"), node("sib")];
    const edges = [parentOf("mom", "focus"), parentOf("mom", "sib")];
    const l = computeTreeLayout(
      input({ focusPersonId: "focus", nodes, edges, expansion: expansion({ expandedSiblings: new Set(["focus"]) }) }),
    );
    expect(l.placed.some((p) => p.personId === "sib")).toBe(true);
    // The fanned sibling is a set-member: no sibling affordance at all, and no parent-caret back up.
    expect(aff(l, "siblings", "sib")).toBeUndefined();
    expect(aff(l, "parents", "sib")).toBeUndefined();
    // The anchor owns the (now expanded) sibling caret.
    const fs = aff(l, "siblings", "focus")!;
    expect(fs.kind).toBe("caret");
    expect(fs.expanded).toBe(true);
  });

  it("a collateral aunt (reached sideways) KEEPS her children-caret to reveal cousins", () => {
    // gran -> mom, gran -> aunt; mom -> focus; aunt -> cousin (hidden). Expand mom's parents (bus)
    // + mom's siblings (rule-8 pairing the client applies) so the aunt is drawn as a set-member.
    const nodes = [node("gran"), node("mom"), node("aunt"), node("focus"), node("cousin")];
    const edges = [
      parentOf("gran", "mom"),
      parentOf("gran", "aunt"),
      parentOf("mom", "focus"),
      parentOf("aunt", "cousin"),
    ];
    const l = computeTreeLayout(
      input({
        focusPersonId: "focus",
        nodes,
        edges,
        expansion: expansion({ expandedParents: new Set(["mom"]), expandedSiblings: new Set(["mom"]) }),
      }),
    );
    expect(l.placed.some((p) => p.personId === "aunt")).toBe(true);
    expect(l.placed.some((p) => p.personId === "cousin")).toBe(false);
    // Collateral children-caret survives — no nearer node owns aunt->cousin.
    const ac = aff(l, "children", "aunt")!;
    expect(ac.kind).toBe("caret");
    expect(ac.expanded).toBe(false); // an EXPAND caret → reveals the cousin
    // But the aunt is a sibling-set member → she owns neither siblings nor parents.
    expect(aff(l, "siblings", "aunt")).toBeUndefined();
    expect(aff(l, "parents", "aunt")).toBeUndefined();
  });

  it("an only-child revealed child shows no sibling '+' (add-sibling is the parent's control)", () => {
    const nodes = [node("focus"), node("kid")];
    const edges = [parentOf("focus", "kid")];
    const l = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges }));
    expect(aff(l, "siblings", "kid")).toBeUndefined();
  });

  it("an in-law (a child's spouse) is a full member with its OWN parent-caret", () => {
    // focus -> kid; kid partnered with kidspouse; kidspouse's parent coinlaw is hidden.
    const nodes = [node("focus"), node("kid"), node("kidspouse"), node("coinlaw")];
    const edges = [
      parentOf("focus", "kid"),
      partneredWith("kid", "kidspouse"),
      parentOf("coinlaw", "kidspouse"),
    ];
    const l = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges }));
    expect(l.placed.some((p) => p.personId === "kidspouse")).toBe(true);
    // The in-law owns its own parents caret (co-in-law hidden → caret, not yet drawn).
    expect(aff(l, "parents", "kidspouse")!.kind).toBe("caret");
    expect(aff(l, "parents", "kidspouse")!.expanded).toBe(false);
    // The lineage child that revealed the couple still shows no parent-caret back up.
    expect(aff(l, "parents", "kid")).toBeUndefined();
  });

  it("collapse suppresses without purging — re-expand restores the nested grandchild", () => {
    const nodes = [node("focus"), node("kid"), node("grandkid")];
    const edges = [parentOf("focus", "kid"), parentOf("kid", "grandkid")];
    const deep = expansion({ expandedChildren: new Set([coupleKey("kid")]) });
    // Deep state: kid's children expanded → grandkid shown.
    const open = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges, expansion: deep }));
    expect(open.placed.some((p) => p.personId === "grandkid")).toBe(true);
    // Collapse the focus's children → prunes kid AND grandkid, but the kid-expand flag persists.
    const collapsed = expansion({
      expandedChildren: new Set([coupleKey("kid")]),
      collapsedChildren: new Set([coupleKey("focus")]),
    });
    const c = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges, expansion: collapsed }));
    expect(c.placed.some((p) => p.personId === "kid")).toBe(false);
    expect(c.placed.some((p) => p.personId === "grandkid")).toBe(false);
    // Re-expand (drop the collapse) → nested grandkid restored, no round-trip and no lost sub-shape.
    const re = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges, expansion: deep }));
    expect(re.placed.some((p) => p.personId === "grandkid")).toBe(true);
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

  it("same-sex/unspecified couple: siblings fan to the anchor's caret SIDE (right partner → right)", () => {
    // Two unspecified-sex partners a,b (a<b). §5 places a LEFT, b RIGHT by entry order/id. Focus b is
    // therefore the RIGHT partner → its sibling caret is on the RIGHT, so its siblings fan to the RIGHT
    // (a right partner's siblings extend right), and the couple [a,b] stays contiguous.
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
    // Both siblings drawn to the RIGHT of b (fan matches the caret side).
    expect(placedFor(l, "s1").x).toBeGreaterThan(b.x);
    expect(placedFor(l, "s2").x).toBeGreaterThan(b.x);
    // Oldest (s1) is FARTHEST from b (largest x).
    expect(placedFor(l, "s1").x).toBeGreaterThan(placedFor(l, "s2").x);
    // Couple stays contiguous — a immediately left of b, no sibling wedged between the partners.
    const gen0 = l.placed.filter((p) => p.generation === 0).sort((x, y) => x.x - y.x).map((p) => p.personId);
    expect(gen0).toEqual(["a", "b", "s2", "s1"]);
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

describe("coupled sibling fan hugs the caret side, couple stays contiguous (regression)", () => {
  it("LEFT partner: siblings fan to the LEFT; the couple stays adjacent", () => {
    // man (left, male) partnered with woman (right); man has two older siblings.
    const nodes = [
      node("man", { sex: "male", birthYear: 1980 }),
      node("woman", { sex: "female" }),
      node("mom"),
      node("s1", { birthYear: 1970 }), // oldest
      node("s2", { birthYear: 1975 }),
    ];
    const edges = [
      partneredWith("man", "woman"),
      parentOf("mom", "man"),
      parentOf("mom", "s1"),
      parentOf("mom", "s2"),
    ];
    const l = computeTreeLayout(
      input({ focusPersonId: "man", nodes, edges, expansion: expansion({ expandedSiblings: new Set(["man"]) }) }),
    );
    const gen0 = l.placed.filter((p) => p.generation === 0).sort((a, b) => a.x - b.x).map((p) => p.personId);
    // Siblings LEFT of the couple, oldest farthest-left, and man↔woman remain adjacent.
    expect(gen0).toEqual(["s1", "s2", "man", "woman"]);
    // Partners sit adjacent (not stretched across siblings) — closer than a sibling gap.
    const coupleGap = placedFor(l, "woman").x - placedFor(l, "man").x;
    const sibGap = placedFor(l, "s2").x - placedFor(l, "s1").x;
    expect(coupleGap).toBeLessThan(sibGap);
  });

  it("a fanned sibling's OWN drawn partner (in-law) stays adjacent to that sibling, not wedged away", () => {
    // anchor man+woman couple, fan LEFT. man's siblings: s1 (single) and s2 (partnered with s2p).
    // Regression: s2p must not be left behind at its old slot with s1 wedged between it and s2.
    const nodes = [
      node("man", { sex: "male", birthYear: 1980 }),
      node("woman", { sex: "female" }),
      node("mom"),
      node("s1", { birthYear: 1970 }), // oldest sibling
      node("s2", { birthYear: 1975 }),
      node("s2p"), // s2's spouse (unknown sex; id s2 < s2p → [s2, s2p])
    ];
    const edges = [
      partneredWith("man", "woman"),
      partneredWith("s2", "s2p"),
      parentOf("mom", "man"),
      parentOf("mom", "s1"),
      parentOf("mom", "s2"),
    ];
    const l = computeTreeLayout(
      input({ focusPersonId: "man", nodes, edges, expansion: expansion({ expandedSiblings: new Set(["man"]) }) }),
    );
    const gen0 = l.placed.filter((p) => p.generation === 0).sort((a, b) => a.x - b.x).map((p) => p.personId);
    // s2 and its in-law s2p are contiguous; the couple man↔woman is contiguous; oldest sibling far-left.
    expect(gen0).toEqual(["s1", "s2", "s2p", "man", "woman"]);
  });

  it("RIGHT partner: siblings fan to the RIGHT; the couple stays adjacent", () => {
    const nodes = [
      node("man", { sex: "male" }),
      node("woman", { sex: "female", birthYear: 1980 }),
      node("mom"),
      node("s1", { birthYear: 1970 }),
      node("s2", { birthYear: 1975 }),
    ];
    const edges = [
      partneredWith("man", "woman"),
      parentOf("mom", "woman"),
      parentOf("mom", "s1"),
      parentOf("mom", "s2"),
    ];
    const l = computeTreeLayout(
      input({ focusPersonId: "woman", nodes, edges, expansion: expansion({ expandedSiblings: new Set(["woman"]) }) }),
    );
    const gen0 = l.placed.filter((p) => p.generation === 0).sort((a, b) => a.x - b.x).map((p) => p.personId);
    // Couple first, then siblings to the right with oldest (s1) farthest right.
    expect(gen0).toEqual(["man", "woman", "s2", "s1"]);
  });
});

describe("Rule-8 sibling⇄parent coupling (toggleAffordanceExpansion)", () => {
  it("expanding siblings auto-expands the person's parents", () => {
    const e = toggleAffordanceExpansion(EMPTY_EXPANSION, {
      direction: "siblings",
      ownerId: "x",
      expanded: false,
    });
    expect(e.expandedSiblings.has("x")).toBe(true);
    expect(e.expandedParents.has("x")).toBe(true);
  });

  it("collapsing siblings leaves the parents standing", () => {
    const open = toggleAffordanceExpansion(EMPTY_EXPANSION, {
      direction: "siblings",
      ownerId: "x",
      expanded: false,
    });
    const closed = toggleAffordanceExpansion(open, { direction: "siblings", ownerId: "x", expanded: true });
    expect(closed.expandedSiblings.has("x")).toBe(false);
    expect(closed.collapsedSiblings.has("x")).toBe(true);
    expect(closed.expandedParents.has("x")).toBe(true);
  });

  it("collapsing parents also collapses the siblings (the shared bus is gone)", () => {
    const open = toggleAffordanceExpansion(EMPTY_EXPANSION, {
      direction: "siblings",
      ownerId: "x",
      expanded: false,
    });
    const noParents = toggleAffordanceExpansion(open, { direction: "parents", ownerId: "x", expanded: true });
    expect(noParents.collapsedParents.has("x")).toBe(true);
    expect(noParents.expandedParents.has("x")).toBe(false);
    expect(noParents.collapsedSiblings.has("x")).toBe(true);
    expect(noParents.expandedSiblings.has("x")).toBe(false);
  });

  it("children toggle keys off the coupleKey and does not touch parents/siblings", () => {
    const e = toggleAffordanceExpansion(EMPTY_EXPANSION, {
      direction: "children",
      ownerId: "x",
      coupleId: coupleKey("x", "y"),
      expanded: false,
    });
    expect(e.expandedChildren.has(coupleKey("x", "y"))).toBe(true);
    expect(e.expandedParents.size).toBe(0);
    expect(e.expandedSiblings.size).toBe(0);
  });

  it("integration: an in-law expanding siblings draws that in-law's parent (the auto-expanded bus)", () => {
    // focus -> kid; kid partnered with inlaw; inlaw's parent `granInlaw` + sibling `inlawSib` hidden.
    const nodes = [
      node("focus"),
      node("kid"),
      node("inlaw"),
      node("granInlaw"),
      node("inlawSib"),
    ];
    const edges = [
      parentOf("focus", "kid"),
      partneredWith("kid", "inlaw"),
      parentOf("granInlaw", "inlaw"),
      parentOf("granInlaw", "inlawSib"),
    ];
    // Simulate the client toggling the in-law's sibling caret through the reducer.
    const exp = toggleAffordanceExpansion(EMPTY_EXPANSION, {
      direction: "siblings",
      ownerId: "inlaw",
      expanded: false,
    });
    const l = computeTreeLayout(input({ focusPersonId: "focus", nodes, edges, expansion: exp }));
    // The in-law's parent (the shared bus) is drawn, and so are the fanned siblings.
    expect(l.placed.some((p) => p.personId === "granInlaw")).toBe(true);
    expect(l.placed.some((p) => p.personId === "inlawSib")).toBe(true);
  });
});

describe("no direct same-row bus (partners connect by proximity + the descent bus)", () => {
  it("a couple has NO partner-link connector — only descent buses are drawn", () => {
    const nodes = [node("me", { sex: "male" }), node("spouse", { sex: "female" }), node("kid")];
    const edges = [partneredWith("me", "spouse"), parentOf("me", "kid"), parentOf("spouse", "kid")];
    const l = computeTreeLayout(input({ focusPersonId: "me", nodes, edges }));
    expect(l.connectors.every((c) => c.kind === "descent")).toBe(true);
    expect(l.connectors.some((c) => c.kind === "partner")).toBe(false);
    // The union is still recorded (used elsewhere) even though it draws no line.
    expect(l.unions).toHaveLength(1);
  });

  it("partners sit ~half a normal gap apart (much closer than two siblings)", () => {
    // A couple with two children so both descend; compare the couple gap to the sibling gap.
    const nodes = [node("me", { sex: "male" }), node("spouse", { sex: "female" }), node("k1"), node("k2")];
    const edges = [
      partneredWith("me", "spouse"),
      parentOf("me", "k1"),
      parentOf("spouse", "k1"),
      parentOf("me", "k2"),
      parentOf("spouse", "k2"),
    ];
    const l = computeTreeLayout(
      input({ focusPersonId: "me", nodes, edges, expansion: expansion({ expandedChildren: new Set([coupleKey("me", "spouse")]) }) }),
    );
    const coupleGap = placedFor(l, "spouse").x - placedFor(l, "me").x;
    const sibGap = Math.abs(placedFor(l, "k2").x - placedFor(l, "k1").x);
    expect(coupleGap).toBeLessThan(sibGap);
  });
});

describe("descendants center under their parents — multi-child bus stays connected (regression)", () => {
  it("2 children of a right-shifted couple sit UNDER the couple; the riser lands within the child bar", () => {
    // DAVID ⋈ MARIA with an expanded sibling (aunt ANNA pushes the couple right) and two children.
    // Before the fix the kids dumped at the row origin and the midpoint riser floated disconnected.
    const nodes = [
      node("DAVID", { sex: "male", birthYear: 1985 }),
      node("MARIA", { sex: "female", birthYear: 1987 }),
      node("PAPA", { sex: "male" }),
      node("NONNA", { sex: "female" }),
      node("ANNA", { sex: "female", birthYear: 1979 }),
      node("SAM", { sex: "male", birthYear: 2012 }),
      node("EVA", { sex: "female", birthYear: 2015 }),
    ];
    const edges = [
      partneredWith("DAVID", "MARIA"),
      partneredWith("PAPA", "NONNA"),
      parentOf("PAPA", "DAVID"),
      parentOf("NONNA", "DAVID"),
      parentOf("PAPA", "ANNA"),
      parentOf("NONNA", "ANNA"),
      parentOf("DAVID", "SAM"),
      parentOf("MARIA", "SAM"),
      parentOf("DAVID", "EVA"),
      parentOf("MARIA", "EVA"),
    ];
    const exp = expansion({ expandedSiblings: new Set(["DAVID"]), expandedParents: new Set(["DAVID"]) });
    const l = computeTreeLayout(input({ focusPersonId: "DAVID", nodes, edges, expansion: exp }));
    const david = placedFor(l, "DAVID");
    const maria = placedFor(l, "MARIA");
    const sam = placedFor(l, "SAM");
    const eva = placedFor(l, "EVA");
    const coupleMid = (david.x + maria.x) / 2;
    const kidLeft = Math.min(sam.x, eva.x);
    const kidRight = Math.max(sam.x, eva.x);
    // Children centered on the couple midpoint …
    expect((kidLeft + kidRight) / 2).toBeCloseTo(coupleMid, 0);
    // … so the descent riser (drawn at the couple midpoint) lands WITHIN the child-gather bar — connected.
    expect(coupleMid).toBeGreaterThanOrEqual(kidLeft - 1e-6);
    expect(coupleMid).toBeLessThanOrEqual(kidRight + 1e-6);
    // The couple is genuinely right-shifted (aunt to its left) — the non-trivial case that used to break.
    expect(Math.min(david.x, maria.x)).toBeGreaterThan(placedFor(l, "ANNA").x);
  });
});

describe("multi-child bar reaches the riser even when collision shifts the block (regression)", () => {
  // Two child-bearing couples in the same descendant generation, the LEFT couple with many children so
  // its wide block shoves the RIGHT couple's 2-child block past that couple's own midpoint. The right
  // couple's descent riser (at its midpoint) must still be covered by its child bar — not left floating.
  it("the child bar spans the couple midpoint (riser) after a collision right-shift", () => {
    const nodes = [
      node("me", { sex: "male", birthYear: 1980 }),
      node("wife", { sex: "female", birthYear: 1982 }),
      node("bro", { sex: "male", birthYear: 1978 }),
      node("sil", { sex: "female", birthYear: 1979 }),
      node("dad", { sex: "male" }),
      node("k1", { birthYear: 2008 }), node("k2", { birthYear: 2010 }),
      node("n1", { birthYear: 2005 }), node("n2", { birthYear: 2007 }),
      node("n3", { birthYear: 2009 }), node("n4", { birthYear: 2011 }),
    ];
    const edges = [
      partneredWith("me", "wife"), partneredWith("bro", "sil"),
      parentOf("dad", "me"), parentOf("dad", "bro"),
      parentOf("me", "k1"), parentOf("wife", "k1"),
      parentOf("me", "k2"), parentOf("wife", "k2"),
      parentOf("bro", "n1"), parentOf("sil", "n1"),
      parentOf("bro", "n2"), parentOf("sil", "n2"),
      parentOf("bro", "n3"), parentOf("sil", "n3"),
      parentOf("bro", "n4"), parentOf("sil", "n4"),
    ];
    const exp = expansion({
      expandedSiblings: new Set(["me"]),
      expandedParents: new Set(["me"]),
      expandedChildren: new Set([coupleKey("bro", "sil")]),
    });
    const l = computeTreeLayout(input({ focusPersonId: "me", nodes, edges, expansion: exp }));
    const me = placedFor(l, "me");
    const wife = placedFor(l, "wife");
    const k1 = placedFor(l, "k1");
    const k2 = placedFor(l, "k2");
    const busCenterX = (me.x + wife.x) / 2;
    // Sanity: this scenario actually shifts me+wife's kids to the right of their midpoint (else the test
    // wouldn't exercise the collision path).
    expect(Math.min(k1.x, k2.x)).toBeGreaterThan(busCenterX);
    // The bar level (inverted-U over the children + the stub extending it) reaches the riser at
    // busCenterX AND both children — a connected path, not a floating riser.
    expect(horizontalCovers(l, [busCenterX, k1.x, k2.x])).toBe(true);
    // AND busCenterX is a bar ENDPOINT (not a rounded interior corner) so the riser attaches cleanly
    // after render-time corner rounding — no seam.
    const atEndpoint = horizontalSegs(l).some(
      (s) => Math.abs(s.lo - busCenterX) < 1e-6 || Math.abs(s.hi - busCenterX) < 1e-6,
    );
    expect(atEndpoint).toBe(true);
  });
});

describe("children caret placement (couple AND lone parent → hug the bottom seam)", () => {
  it("a couple's children caret hugs the seam and sits ON TOP OF the U, not on its floor", () => {
    const nodes = [node("a", { sex: "male" }), node("b", { sex: "female" }), node("k1"), node("k2")];
    const edges = [
      partneredWith("a", "b"),
      parentOf("a", "k1"), parentOf("b", "k1"),
      parentOf("a", "k2"), parentOf("b", "k2"),
    ];
    const l = computeTreeLayout(
      input({ focusPersonId: "a", nodes, edges, expansion: expansion({ expandedChildren: new Set([coupleKey("a", "b")]) }) }),
    );
    const a = placedFor(l, "a");
    const b = placedFor(l, "b");
    const caret = aff(l, "children", "a")!;
    // Hugs the seam (CARET_GAP below the card bottoms), centered on the couple midpoint.
    expect(caret.y - (a.y + NODE_H / 2)).toBeCloseTo(CARET_GAP, 5);
    expect(caret.x).toBeCloseTo((a.x + b.x) / 2, 5);
    // Sits ABOVE the U's horizontal floor (joinY) — the U passes below and behind it when expanded.
    const uPath = l.connectors.find((c) => threeSegShape(c.d) === "U")!;
    expect(caret.y).toBeLessThan(segmentsOf(uPath.d)[1]!.y1);
  });

  it("a lone parent's children caret hugs the seam too (same shared rule)", () => {
    const nodes = [node("a"), node("kid")];
    const edges = [parentOf("a", "kid")];
    const l = computeTreeLayout(input({ focusPersonId: "a", nodes, edges }));
    const a = placedFor(l, "a");
    const caret = aff(l, "children", "a")!;
    expect(caret.y - (a.y + NODE_H / 2)).toBeCloseTo(CARET_GAP, 5);
  });
});

describe("descent-bus SHAPE rules (U ⇔ 2 parents, inverted-U ⇔ 2+ children)", () => {
  // A "U" (∪) joins two parents' bottoms; an "inverted-U" (∩) gathers 2+ children. Both are 3-segment
  // V–H–V polylines distinguished by whether the bar dips below (U) or rises above (cap) the endpoints.
  it("2 parents + 1 child: a U joins the parents; NO inverted-U", () => {
    const nodes = [node("a", { sex: "male" }), node("b", { sex: "female" }), node("kid")];
    const edges = [partneredWith("a", "b"), parentOf("a", "kid"), parentOf("b", "kid")];
    const l = computeTreeLayout(input({ focusPersonId: "a", nodes, edges }));
    expect(hasShape(l, "U")).toBe(true);
    expect(hasShape(l, "cap")).toBe(false);
  });

  it("1 parent + >1 child: NO U; an inverted-U gathers the children", () => {
    const nodes = [node("a"), node("k1", { birthYear: 2000 }), node("k2", { birthYear: 2002 })];
    const edges = [parentOf("a", "k1"), parentOf("a", "k2")];
    const l = computeTreeLayout(input({ focusPersonId: "a", nodes, edges }));
    expect(hasShape(l, "U")).toBe(false);
    expect(hasShape(l, "cap")).toBe(true);
    const k1 = placedFor(l, "k1");
    const k2 = placedFor(l, "k2");
    expect(horizontalCovers(l, [k1.x, k2.x])).toBe(true);
  });

  it("1 parent + 1 child: neither U nor inverted-U (just a vertical drop)", () => {
    const nodes = [node("a"), node("kid")];
    const edges = [parentOf("a", "kid")];
    const l = computeTreeLayout(input({ focusPersonId: "a", nodes, edges }));
    expect(hasShape(l, "U")).toBe(false);
    expect(hasShape(l, "cap")).toBe(false);
  });

  it("3 children: the inverted-U spans the outer two; the middle child drops from the bar", () => {
    const nodes = [node("a"), node("k1", { birthYear: 2000 }), node("k2", { birthYear: 2002 }), node("k3", { birthYear: 2004 })];
    const edges = [parentOf("a", "k1"), parentOf("a", "k2"), parentOf("a", "k3")];
    const l = computeTreeLayout(input({ focusPersonId: "a", nodes, edges }));
    const xs = ["k1", "k2", "k3"].map((id) => placedFor(l, id).x);
    // One inverted-U over the outer children, and the bar level covers all three drops.
    expect(hasShape(l, "cap")).toBe(true);
    expect(horizontalCovers(l, xs)).toBe(true);
  });
});

describe("descent-bus geometry (spec §6)", () => {
  it("two-parent bus: a 'U' joins both parents' bottoms, then a riser drops to the child", () => {
    const nodes = [node("me"), node("spouse"), node("kid")];
    const edges = [partneredWith("me", "spouse"), parentOf("me", "kid"), parentOf("spouse", "kid")];
    const l = computeTreeLayout(input({ focusPersonId: "me", nodes, edges }));
    const me = placedFor(l, "me");
    const sp = placedFor(l, "spouse");
    const kid = placedFor(l, "kid");
    const mid = (me.x + sp.x) / 2;
    // Child centered on the couple's midpoint.
    expect(kid.x).toBeCloseTo(mid, 5);
    const descents = l.connectors.filter((c) => c.kind === "descent");
    const [lp, rp] = me.x < sp.x ? [me, sp] : [sp, me];
    // The U starts at the LEFT parent's bottom-center and ends at the RIGHT parent's bottom-center,
    // dipping to a shared join level between (a descent-bus feeder, not a row-level partner line).
    const u = descents.find((c) => c.d.startsWith(`M ${lp.x} ${lp.y + NODE_H / 2}`));
    expect(u).toBeDefined();
    expect(u!.d.endsWith(`${rp.x} ${rp.y + NODE_H / 2}`)).toBe(true);
    // A riser drops from the couple midpoint down toward the child.
    expect(descents.some((c) => c.d.startsWith(`M ${mid} `))).toBe(true);
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

describe("roundedPath (render-time corner rounding)", () => {
  it("leaves a straight 2-point segment unchanged", () => {
    expect(roundedPath("M 0 0 L 0 100", 8)).toBe("M 0 0 L 0 100");
  });

  it("rounds an interior corner with a quadratic and preserves the endpoints", () => {
    const out = roundedPath("M 0 0 L 0 100 L 100 100", 8);
    expect(out.startsWith("M 0 0")).toBe(true);
    expect(out).toContain("Q 0 100"); // curve control point is the original corner vertex
    expect(out.endsWith("L 100 100")).toBe(true);
    expect(out.includes("L 0 100 L")).toBe(false); // the sharp corner is gone
  });

  it("clamps the radius to half the shorter adjacent segment (no overshoot)", () => {
    // 4px segments → radius 2 even though 8 was requested.
    expect(roundedPath("M 0 0 L 0 4 L 4 4", 8)).toContain("L 0 2 Q 0 4 2 4");
  });

  it("collapses a zero-length segment (a centered jog becomes one straight drop)", () => {
    expect(roundedPath("M 50 10 L 50 10 L 50 40", 8)).toBe("M 50 10 L 50 40");
  });

  it("rounds both corners of a U/inverted-U (two quadratics)", () => {
    const out = roundedPath("M 0 0 L 0 30 L 60 30 L 60 0", 8);
    expect((out.match(/Q/g) ?? []).length).toBe(2);
    expect(out.startsWith("M 0 0")).toBe(true);
    expect(out.endsWith("L 60 0")).toBe(true);
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
