// Pure, dependency-free layout for the visual family tree — PORTRAIT pedigree navigation (ADR-0016).
// Portrait pedigree (FamilySearch-style): generations stack VERTICALLY. Ancestors sit ABOVE the focus
// (smaller y), descendants BELOW (larger y); the focus row is in the middle. Within a generation, cards
// spread horizontally (x) in birth order, partners kept adjacent. Expand/collapse/fetch carets live in
// the vertical gutter — ancestors on a card's TOP edge, descendants on its BOTTOM edge.
// See docs/superpowers/specs/2026-07-12-kinship-tree-pedigree-nav-design.md.
//
// NOTE: named `tree-layout.ts` (not `layout.ts`) because `layout.*` is a reserved Next.js App Router
// file convention. This module imports TYPES ONLY — no DB, no React — so it is safe to run on server
// or client and trivial to unit-test. Do not add runtime dependencies here.

import type { KinshipTreeData, ResolvedKinshipEdge, TreeNode } from "@chronicle/core";

/**
 * What the user has revealed beyond the default bounded window. The layout is a pure function of
 * (nodes, edges, root, expansion) — it re-runs on whatever node/edge set is present; fetching more
 * nodes at a boundary is the client's job (TreeCanvas), not the layout's.
 */
export interface ExpansionState {
  /** Nodes whose hidden parents have been revealed. */
  expandedParents: ReadonlySet<string>;
  /** Nodes whose hidden children have been revealed. */
  expandedChildren: ReadonlySet<string>;
  /** Nodes whose (already-drawn) ancestor branch the user has manually COLLAPSED — pruned from draw. */
  collapsedAncestors: ReadonlySet<string>;
  /** Nodes whose (already-drawn) descendant branch the user has manually COLLAPSED — pruned from draw. */
  collapsedChildren: ReadonlySet<string>;
}

export const EMPTY_EXPANSION: ExpansionState = {
  expandedParents: new Set(),
  expandedChildren: new Set(),
  collapsedAncestors: new Set(),
  collapsedChildren: new Set(),
};

/**
 * Stable key for a couple (or a lone person). Order-independent: `coupleKey(a,b)`
 * equals `coupleKey(b,a)`. A single person keys to their own id.
 */
export function coupleKey(a: string, b?: string): string {
  if (!b) return a;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface PlacedNode {
  personId: string;
  x: number;
  y: number;
  /** Generation relative to root (0 = root, negative = ancestors, positive = descendants). */
  generation: number;
  node: TreeNode;
}

/** A partner pair drawn adjacent, for the partner-link glyph. */
export interface PlacedUnion {
  aPersonId: string;
  bPersonId: string;
  x: number;
  y: number;
}

export interface Connector {
  /** SVG path data for a parent→child or partner link. */
  d: string;
  kind: "descent" | "partner";
}

/**
 * ONE per-edge expand/collapse/fetch control the canvas renders as a caret in a node's OUTER gutter.
 *
 * There is at most ONE affordance per (node, direction): a node never stacks two glyphs on the same
 * edge. `ancestors` sits in the node's ancestor (TOP) gutter; `descendants` in the descendant (BOTTOM)
 * gutter. The `state` tells the canvas what activating it does:
 *   - `"collapse"` — a drawn branch exists on that side; hide it (client-only prune, adds to the
 *     collapsed set).
 *   - `"expand"` — the branch is currently collapsed; un-prune it (client-only, removes from the set).
 *   - `"fetch"` — undrawn kin exist at the boundary (hidden at the server, or loaded-but-not-drawn);
 *     activating calls the client's `revealFetch` in that direction, anchored on `personId`.
 */
export interface EdgeAffordance {
  direction: "ancestors" | "descendants";
  personId: string;
  x: number;
  y: number;
  state: "collapse" | "expand" | "fetch";
}

/**
 * An inline "add parent" placeholder in the ancestor (TOP) gutter of a drawn node that has zero
 * drawn parent edges AND no hidden parents at the boundary. Clicking it opens the add-parent flow
 * anchored on `personId` — this is how the connecting (possibly unnamed) bridge person is created.
 * (Children/partner adds are kebab-only; the layout emits no slots for them.)
 */
export interface EmptyParentSlot {
  personId: string;
  x: number;
  y: number;
}

export interface TreeLayout {
  placed: PlacedNode[];
  unions: PlacedUnion[];
  connectors: Connector[];
  affordances: EdgeAffordance[];
  emptyParentSlots: EmptyParentSlot[];
  bounds: { width: number; height: number };
}

export interface LayoutInput {
  nodes: readonly TreeNode[];
  edges: readonly ResolvedKinshipEdge[];
  rootPersonId: string;
  expansion: ExpansionState;
}

// ---------------------------------------------------------------------------
// Geometry constants. Coordinate system: SVG-native — (0,0) top-left, x grows
// right, y grows down. PORTRAIT pedigree axis: generation maps to Y (ancestors
// UP, descendants DOWN); within-generation stacking maps to X. All emitted
// coordinates are node CENTERS in px, normalized so the tightest bounding box
// starts at (0,0) — with NODE_W/2 side padding and enough top headroom that the
// ancestor-gutter carets/slots aren't clipped. Units are px.
// ---------------------------------------------------------------------------

export const NODE_W = 150; // node card width (px) — portrait card (FamilySearch-style)
export const NODE_H = 172; // node card height (px) — portrait card (monogram on top, name below)
const CROSS_H_GAP = 22; // horizontal gap between stacked same-generation cards (siblings / partners)
const GEN_V_GAP = 64; // vertical gap between generation rows (leaves room for gutter carets)

const CROSS_STEP = NODE_W + CROSS_H_GAP; // center-to-center horizontal step within a generation row
const GEN_STEP = NODE_H + GEN_V_GAP; // center-to-center vertical step between generation rows

/** How far a gutter caret / add-parent slot floats out past the card edge (px). */
export const CARET_GAP = 16;
/** Extra headroom above the top row so the ancestor-gutter carets/slots stay within bounds. */
const TOP_PAD = 30;

const DEFAULT_WINDOW_UP = 2;
const DEFAULT_WINDOW_DOWN = 2;

/** The default bounded neighborhood: ±2 generations from root. */
export const DEFAULT_LAYOUT_WINDOW = {
  up: DEFAULT_WINDOW_UP,
  down: DEFAULT_WINDOW_DOWN,
} as const;

/** Stable normalized key for an edge, used for deterministic ordering & dedup. */
function edgeKey(e: ResolvedKinshipEdge): string {
  return `${e.edgeType}:${e.personAId}:${e.personBId}`;
}

/**
 * Compute node positions, connector geometry, per-edge affordances (collapse/expand/fetch), and
 * empty-parent slots for the current node/edge set rooted at `rootPersonId`. Deterministic (stable
 * ordering) so identical data always lays out identically.
 *
 * Pure & dependency-free.
 */
export function computeTreeLayout(input: LayoutInput): TreeLayout {
  const { rootPersonId, expansion } = input;

  // --- Index nodes & edges deterministically -----------------------------
  const nodeById = new Map<string, TreeNode>();
  for (const n of input.nodes) {
    if (!nodeById.has(n.personId)) nodeById.set(n.personId, n);
  }
  const sortedNodeIds = [...nodeById.keys()].sort();

  const edgeByKey = new Map<string, ResolvedKinshipEdge>();
  for (const e of input.edges) {
    const k = edgeKey(e);
    if (!edgeByKey.has(k)) edgeByKey.set(k, e);
  }
  const sortedEdges = [...edgeByKey.values()].sort((a, b) =>
    edgeKey(a) < edgeKey(b) ? -1 : edgeKey(a) > edgeKey(b) ? 1 : 0,
  );

  // Adjacency, built only from edges whose BOTH endpoints are loaded nodes.
  const parentsOf = new Map<string, string[]>(); // child -> parents
  const childrenOf = new Map<string, string[]>(); // parent -> children
  const partnersOf = new Map<string, string[]>(); // person -> partners

  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const arr = m.get(k);
    if (arr) {
      if (!arr.includes(v)) arr.push(v);
    } else m.set(k, [v]);
  };

  for (const e of sortedEdges) {
    if (!nodeById.has(e.personAId) || !nodeById.has(e.personBId)) continue;
    if (e.edgeType === "parent_of") {
      push(childrenOf, e.personAId, e.personBId);
      push(parentsOf, e.personBId, e.personAId);
    } else {
      push(partnersOf, e.personAId, e.personBId);
      push(partnersOf, e.personBId, e.personAId);
    }
  }

  // --- Generation assignment via BFS from root ---------------------------
  const generation = new Map<string, number>();
  if (nodeById.has(rootPersonId)) {
    generation.set(rootPersonId, 0);
    const queue: string[] = [rootPersonId];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++]!;
      const g = generation.get(cur)!;
      const neighbors: Array<[string, number]> = [];
      for (const p of parentsOf.get(cur) ?? []) neighbors.push([p, g - 1]);
      for (const c of childrenOf.get(cur) ?? []) neighbors.push([c, g + 1]);
      for (const s of partnersOf.get(cur) ?? []) neighbors.push([s, g]);
      neighbors.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      for (const [id, ng] of neighbors) {
        if (!generation.has(id)) {
          generation.set(id, ng);
          queue.push(id);
        }
      }
    }
  }

  // --- Windowing: which reachable nodes are actually DRAWN ----------------
  const drawable = new Set<string>();
  {
    const reachable = [...generation.keys()];
    const inWindow = (g: number) => g >= -DEFAULT_WINDOW_UP && g <= DEFAULT_WINDOW_DOWN;

    for (const id of reachable) {
      if (inWindow(generation.get(id)!)) drawable.add(id);
    }
    // Iteratively pull in revealed boundary kin until fixpoint.
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of [...drawable].sort()) {
        if (expansion.expandedParents.has(id)) {
          for (const p of parentsOf.get(id) ?? []) {
            if (generation.has(p) && !drawable.has(p)) {
              drawable.add(p);
              changed = true;
            }
          }
        }
        if (expansion.expandedChildren.has(id)) {
          for (const c of childrenOf.get(id) ?? []) {
            if (generation.has(c) && !drawable.has(c)) {
              drawable.add(c);
              changed = true;
            }
          }
        }
        // A partner of a drawn node is always shown adjacent as a union (same generation).
        for (const s of partnersOf.get(id) ?? []) {
          if (generation.has(s) && !drawable.has(s)) {
            drawable.add(s);
            changed = true;
          }
        }
      }
    }
    // Apply per-box manual collapse cuts. Re-walk the drawable graph from root, refusing to cross a
    // cut: a node in `collapsedAncestors` blocks the walk from ascending into its parents; a node in
    // `collapsedChildren` blocks the walk from descending into its children. Any drawable node no
    // longer reached from root is removed (prunes the whole cut branch). Partners are always crossable
    // (a collapse hides a branch, never a spouse).
    {
      const cutUp = expansion.collapsedAncestors;
      const cutDown = expansion.collapsedChildren;
      const keep = new Set<string>();
      const stack: string[] = nodeById.has(rootPersonId) ? [rootPersonId] : [];
      while (stack.length) {
        const cur = stack.pop()!;
        if (keep.has(cur) || !drawable.has(cur)) continue;
        keep.add(cur);
        if (!cutUp.has(cur))
          for (const p of parentsOf.get(cur) ?? []) if (drawable.has(p)) stack.push(p);
        if (!cutDown.has(cur))
          for (const c of childrenOf.get(cur) ?? []) if (drawable.has(c)) stack.push(c);
        for (const s of partnersOf.get(cur) ?? []) if (drawable.has(s)) stack.push(s);
      }
      for (const id of [...drawable]) if (!keep.has(id)) drawable.delete(id);
    }
  }

  // --- Group drawn nodes by generation, in deterministic order -----------
  const byGen = new Map<number, string[]>();
  for (const id of sortedNodeIds) {
    if (!drawable.has(id)) continue;
    const g = generation.get(id)!;
    const arr = byGen.get(g);
    if (arr) arr.push(id);
    else byGen.set(g, [id]);
  }
  const drawnGens = [...byGen.keys()].sort((a, b) => a - b);

  // --- y by generation (portrait pedigree) -------------------------------
  // Ancestors have negative generation → smaller y (UP); descendants positive
  // generation → larger y (DOWN); focus at y=0. Same generation ⇒ same y row.
  const yForGen = (g: number) => g * GEN_STEP;

  // --- Horizontal (x) placement within each generation row ----------------
  // Order a row by birthYear (nulls LAST, then id tiebreak), keeping union/
  // partner clusters contiguous & adjacent. A child is nudged toward the
  // midpoint of its drawn parents where feasible, but birth-order + determinism
  // win.

  const x = new Map<string, number>();

  // Comparator: birthYear ascending, nulls last, id tiebreak.
  const cmpBirth = (a: string, b: string): number => {
    const ba = nodeById.get(a)!.birthYear;
    const bb = nodeById.get(b)!.birthYear;
    if (ba != null && bb != null) {
      if (ba !== bb) return ba - bb;
    } else if (ba != null) {
      return -1; // a dated, b null ⇒ a first
    } else if (bb != null) {
      return 1; // b dated, a null ⇒ b first
    }
    return a < b ? -1 : a > b ? 1 : 0;
  };

  // Build, per generation, a birth-ordered list with partner clusters kept
  // contiguous. We anchor each cluster at its earliest-born (min by cmpBirth)
  // member so a union sorts by its senior partner, then append the rest of the
  // cluster right after in cmpBirth order.
  const orderedByGen = new Map<number, string[]>();
  for (const g of drawnGens) {
    const members = (byGen.get(g) ?? []).slice();

    // Partition into partner-connected clusters (drawn, same generation).
    const clusterOf = new Map<string, number>();
    let nextCluster = 0;
    for (const id of members.slice().sort()) {
      if (clusterOf.has(id)) continue;
      const cid = nextCluster++;
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop()!;
        if (clusterOf.has(cur)) continue;
        clusterOf.set(cur, cid);
        for (const s of partnersOf.get(cur) ?? []) {
          if (drawable.has(s) && generation.get(s) === g && !clusterOf.has(s)) {
            stack.push(s);
          }
        }
      }
    }
    const clusters = new Map<number, string[]>();
    for (const id of members) {
      const cid = clusterOf.get(id)!;
      const arr = clusters.get(cid);
      if (arr) arr.push(id);
      else clusters.set(cid, [id]);
    }
    // Within a cluster, order members by cmpBirth (senior first, deterministic).
    const clusterList = [...clusters.values()].map((mem) => mem.slice().sort(cmpBirth));
    // Order clusters by their senior (first) member's cmpBirth key.
    clusterList.sort((a, b) => cmpBirth(a[0]!, b[0]!));
    orderedByGen.set(g, clusterList.flat());
  }

  // Assign provisional x left→right within each row.
  for (const g of drawnGens) {
    const order = orderedByGen.get(g)!;
    order.forEach((id, i) => x.set(id, i * CROSS_STEP));
  }

  // Best-effort parent-near-children nudge: a child with drawn parents is centered
  // on its parents' x-mean; process descendant rows (larger generation) using
  // parent rows already placed. To stay deterministic and satisfy the single-child-
  // centering contract without destabilizing sibling stacks, we only re-center a
  // child row when EVERY node in it maps 1:1 to a distinct drawn-parent-set x-mean
  // and the resulting order is strictly increasing (i.e. no overlap) — otherwise the
  // birth-ordered provisional slots stand.
  for (const g of drawnGens) {
    if (g <= 0) continue; // only descendant rows hang off parents
    const order = orderedByGen.get(g)!;
    const desired = new Map<string, number>();
    let ok = true;
    for (const id of order) {
      const drawnParents = (parentsOf.get(id) ?? []).filter((p) => drawable.has(p) && x.has(p));
      if (drawnParents.length === 0) {
        ok = false;
        break;
      }
      const mean = drawnParents.reduce((acc, p) => acc + x.get(p)!, 0) / drawnParents.length;
      desired.set(id, mean);
    }
    if (!ok) continue;
    // Keep birth order; require the desired means to be non-overlapping (≥ CROSS_STEP
    // apart) in that order. If so, adopt them; else leave provisional slots.
    let strictly = true;
    for (let i = 1; i < order.length; i++) {
      if (desired.get(order[i]!)! - desired.get(order[i - 1]!)! < CROSS_STEP - 1e-6) {
        strictly = false;
        break;
      }
    }
    if (strictly) {
      for (const id of order) x.set(id, desired.get(id)!);
    }
  }

  // --- Assemble placed nodes ----------------------------------------------
  const rawY = new Map<string, number>();
  for (const id of drawable) rawY.set(id, yForGen(generation.get(id)!));

  // Normalize both axes so the tightest bounding box (card edges) starts at 0.
  // The top axis gets extra headroom (TOP_PAD) so ancestor-gutter carets don't clip.
  const drawnIds = [...drawable];
  let minX = Infinity;
  let minY = Infinity;
  for (const id of drawnIds) {
    minX = Math.min(minX, x.get(id)!);
    minY = Math.min(minY, rawY.get(id)!);
  }
  if (!isFinite(minX)) minX = 0;
  if (!isFinite(minY)) minY = 0;
  const offsetX = -minX + NODE_W / 2;
  const offsetY = -minY + NODE_H / 2 + TOP_PAD;

  const placed: PlacedNode[] = drawnIds
    .map((id) => ({
      personId: id,
      x: x.get(id)! + offsetX,
      y: rawY.get(id)! + offsetY,
      generation: generation.get(id)!,
      node: nodeById.get(id)!,
    }))
    .sort((a, b) =>
      a.generation !== b.generation
        ? a.generation - b.generation
        : a.x !== b.x
          ? a.x - b.x
          : a.personId < b.personId
            ? -1
            : 1,
    );

  const posOf = new Map(placed.map((p) => [p.personId, p]));

  // --- Unions (drawn partner pairs) --------------------------------------
  const unions: PlacedUnion[] = [];
  const unionSeen = new Set<string>();
  for (const e of sortedEdges) {
    if (e.edgeType !== "partnered_with") continue;
    const a = posOf.get(e.personAId);
    const b = posOf.get(e.personBId);
    if (!a || !b) continue;
    const key = `${e.personAId}|${e.personBId}`;
    if (unionSeen.has(key)) continue;
    unionSeen.add(key);
    unions.push({
      aPersonId: e.personAId,
      bPersonId: e.personBId,
      x: (a.x + b.x) / 2,
      y: a.y, // partners share a generation ⇒ same y row
    });
  }

  // --- Connectors ---------------------------------------------------------
  // Descent (vertical axis): a parent (smaller generation) sits ABOVE its child,
  // so the connector runs from the parent's BOTTOM edge to the child's TOP edge,
  // elbowed via a mid-Y.
  const connectors: Connector[] = [];
  for (const e of sortedEdges) {
    if (e.edgeType !== "parent_of") continue;
    const p = posOf.get(e.personAId);
    const c = posOf.get(e.personBId);
    if (!p || !c) continue;
    const px = p.x;
    const py = p.y + NODE_H / 2; // parent's child-facing (BOTTOM) edge
    const cx = c.x;
    const cy = c.y - NODE_H / 2; // child's parent-facing (TOP) edge
    const midY = (py + cy) / 2;
    connectors.push({
      kind: "descent",
      d: `M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cy}`,
    });
  }
  // Partner (horizontal): the two cards share a y row and differ in x. Link runs
  // from the left card's RIGHT edge to the right card's LEFT edge.
  for (const u of unions) {
    const a = posOf.get(u.aPersonId)!;
    const b = posOf.get(u.bPersonId)!;
    const left = a.x < b.x ? a : b;
    const right = a.x < b.x ? b : a;
    connectors.push({
      kind: "partner",
      d: `M ${left.x + NODE_W / 2} ${left.y} L ${right.x - NODE_W / 2} ${right.y}`,
    });
  }

  // --- Per-edge affordances (collapse / expand / fetch) -------------------
  // Exactly ONE affordance per (node, direction) — never two glyphs on the same edge. State per edge:
  //   ANCESTOR (TOP) gutter, for a drawn node with id and loadedParents / drawnParents:
  //     • node ∈ collapsedAncestors AND it has parents to show (loaded or hidden) → "expand".
  //     • else drawnParents.length > 0 (a drawn branch exists) → "collapse".
  //     • else undrawn parents exist (hasHiddenParents, or loaded-but-not-drawn) → "fetch".
  //       (This "fetch" is what preserves Finding 1: a loaded-but-undrawn parent yields a fetch caret,
  //       NOT an EmptyParentSlot, so activating it can never mint a duplicate parent.)
  //     • else (zero loaded parents and no hidden) → NO affordance; the EmptyParentSlot fires instead.
  //   DESCENDANT (BOTTOM) gutter mirrors the above with children / collapsedChildren / hasHiddenChildren.
  const affordances: EdgeAffordance[] = [];
  for (const p of placed) {
    const id = p.personId;
    const n = p.node;

    // Ancestor (top) gutter.
    {
      const loadedParents = parentsOf.get(id) ?? [];
      const drawnParents = loadedParents.filter((pp) => drawable.has(pp));
      const hasHidden = n.hasHiddenParents;
      const hasUndrawn = hasHidden || drawnParents.length < loadedParents.length;
      let state: EdgeAffordance["state"] | null = null;
      if (expansion.collapsedAncestors.has(id) && (loadedParents.length > 0 || hasHidden)) {
        state = "expand";
      } else if (drawnParents.length > 0) {
        state = "collapse";
      } else if (hasUndrawn) {
        state = "fetch";
      }
      if (state) {
        affordances.push({
          direction: "ancestors",
          personId: id,
          x: p.x,
          y: p.y - NODE_H / 2 - CARET_GAP,
          state,
        });
      }
    }

    // Descendant (bottom) gutter.
    {
      const loadedChildren = childrenOf.get(id) ?? [];
      const drawnChildren = loadedChildren.filter((cc) => drawable.has(cc));
      const hasHidden = n.hasHiddenChildren;
      const hasUndrawn = hasHidden || drawnChildren.length < loadedChildren.length;
      let state: EdgeAffordance["state"] | null = null;
      if (expansion.collapsedChildren.has(id) && (loadedChildren.length > 0 || hasHidden)) {
        state = "expand";
      } else if (drawnChildren.length > 0) {
        state = "collapse";
      } else if (hasUndrawn) {
        state = "fetch";
      }
      if (state) {
        affordances.push({
          direction: "descendants",
          personId: id,
          x: p.x,
          y: p.y + NODE_H / 2 + CARET_GAP,
          state,
        });
      }
    }
  }
  affordances.sort((a, b) =>
    a.direction !== b.direction
      ? a.direction < b.direction
        ? -1
        : 1
      : a.personId < b.personId
        ? -1
        : a.personId > b.personId
          ? 1
          : 0,
  );

  // --- Empty parent slots -------------------------------------------------
  // One per drawn node with ZERO LOADED parent edges AND hasHiddenParents === false — i.e. a node with
  // NO parent recorded at all (truly the add-parent frontier / bridge creation point), in the ancestor
  // (TOP) gutter. Uses the UNFILTERED loaded-parent count, not the drawn count: a node that has a
  // loaded-but-undrawn parent already HAS a parent, so offering "Add parent" there would create a
  // duplicate/conflicting edge (Finding 1). Such a node gets an ancestor 'fetch' affordance instead
  // (above). Mutually exclusive with the ancestor affordance: slot ⇔ zero loaded parents AND no hidden;
  // affordance ⇔ some drawn/undrawn parent (drawn ⇒ collapse/expand, hidden/loaded-not-drawn ⇒ fetch).
  const emptyParentSlots: EmptyParentSlot[] = [];
  for (const p of placed) {
    const loadedParents = parentsOf.get(p.personId) ?? [];
    if (loadedParents.length === 0 && !p.node.hasHiddenParents) {
      emptyParentSlots.push({
        personId: p.personId,
        x: p.x,
        y: p.y - NODE_H / 2 - CARET_GAP,
      });
    }
  }
  emptyParentSlots.sort((a, b) => (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0));

  // --- Bounds -------------------------------------------------------------
  let width = NODE_W;
  let height = NODE_H;
  for (const p of placed) {
    width = Math.max(width, p.x + NODE_W / 2);
    height = Math.max(height, p.y + NODE_H / 2);
  }
  for (const a of affordances) {
    width = Math.max(width, a.x + NODE_W / 2);
    height = Math.max(height, a.y + NODE_H / 2);
  }
  for (const s of emptyParentSlots) {
    width = Math.max(width, s.x + NODE_W / 2);
    height = Math.max(height, s.y + NODE_H / 2);
  }

  return { placed, unions, connectors, affordances, emptyParentSlots, bounds: { width, height } };
}

/** Convenience: build layout straight from a {@link KinshipTreeData} read + expansion state. */
export function layoutFromTreeData(
  data: KinshipTreeData,
  expansion: ExpansionState = EMPTY_EXPANSION,
): TreeLayout {
  return computeTreeLayout({
    nodes: data.nodes,
    edges: data.edges,
    rootPersonId: data.rootPersonId,
    expansion,
  });
}
