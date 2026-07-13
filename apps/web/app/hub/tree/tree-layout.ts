// Pure, dependency-free layout for the visual family tree — pedigree navigation (ADR-0016).
// Directional pedigree: ancestors extend RIGHT (+x), descendants LEFT (−x), focus at x=0.
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
 * ONE per-edge expand/collapse/fetch control the canvas renders as a caret on a node's OUTER edge.
 *
 * There is at most ONE affordance per (node, direction): a node never stacks two glyphs on the same
 * edge. `ancestors` sits on the node's ancestor (RIGHT) edge; `descendants` on the descendant (LEFT)
 * edge. The `state` tells the canvas what activating it does:
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
 * An inline "add parent" placeholder on the ancestor (RIGHT) edge of a drawn node that has zero
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
// right, y grows down. Pedigree axis: generation maps to X (ancestors right,
// descendants left); within-generation stacking maps to Y. All emitted
// coordinates are node CENTERS in px, normalized so the tightest bounding box
// starts at (0,0) with NODE_W/2 and NODE_H/2 padding — i.e. every node card
// fits inside `bounds`. Units are px.
// ---------------------------------------------------------------------------

export const NODE_W = 210; // node card width (px)
export const NODE_H = 84; // node card height (px)
const H_GAP = 56; // horizontal gap between generation columns (card edge to edge)
const V_GAP = 44; // vertical gap between stacked same-generation cards

const COL_STEP = NODE_W + H_GAP; // center-to-center horizontal step between generation columns
const ROW_STEP = NODE_H + V_GAP; // center-to-center vertical step between stacked cards

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

  // --- x by generation (pedigree transpose) ------------------------------
  // Ancestors have negative generation → positive x (RIGHT); descendants positive
  // generation → negative x (LEFT); focus at x=0. Same generation ⇒ same x column.
  const xForGen = (g: number) => -g * COL_STEP;

  // --- Vertical (y) placement within each generation column ---------------
  // Order a column by birthYear (nulls LAST, then id tiebreak), keeping union/
  // partner clusters contiguous & adjacent. A parent is nudged toward the
  // midpoint of its drawn children where feasible, but birth-order + determinism
  // win. Y is assigned per-column in ascending generation order so a parent's
  // children (one column to the LEFT, larger generation) — no: children are drawn
  // in a LATER column iteration. We instead assign y descendant-first isn't
  // needed; we anchor children on parents via a two-pass approach:
  //   pass 1: place every column by birth order into provisional slots.
  //   pass 2: for a child with drawn parents, we already ordered columns; parent
  //           y is nudged toward its drawn children's mean AFTER children placed.
  // To keep this simple & deterministic we place from the DESCENDANT side inward
  // is unnecessary; the spec says birth-order + determinism win, parent-near-
  // children is best-effort. We do: order each column by (birthYear,id) with union
  // clusters contiguous, lay them out top→down at ROW_STEP; then for the child-
  // centering test (single child under a union) we special-case: a lone child of
  // a fully-drawn set of parents is centered on its parents' y-mean.

  const y = new Map<string, number>();

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

  // Assign provisional y top→down within each column.
  for (const g of drawnGens) {
    const order = orderedByGen.get(g)!;
    order.forEach((id, i) => y.set(id, i * ROW_STEP));
  }

  // Best-effort parent-near-children nudge: a child with drawn parents is centered
  // on its parents' y-mean; process descendant columns (larger generation) using
  // parent columns already placed. But parents (smaller gen) sit in a column
  // processed EARLIER above with provisional y; to center a lone child on its
  // parents we recompute child columns from parent y-means, keeping birth order
  // when a column has multiple children. To stay deterministic and satisfy the
  // single-child-centering contract without destabilizing sibling stacks, we only
  // re-center a child column when EVERY node in it maps 1:1 to a distinct drawn-
  // parent-set y-mean and the resulting order is strictly increasing (i.e. no
  // overlap) — otherwise the birth-ordered provisional slots stand.
  for (const g of drawnGens) {
    if (g <= 0) continue; // only descendant columns hang off parents
    const order = orderedByGen.get(g)!;
    const desired = new Map<string, number>();
    let ok = true;
    for (const id of order) {
      const drawnParents = (parentsOf.get(id) ?? []).filter((p) => drawable.has(p) && y.has(p));
      if (drawnParents.length === 0) {
        ok = false;
        break;
      }
      const mean = drawnParents.reduce((acc, p) => acc + y.get(p)!, 0) / drawnParents.length;
      desired.set(id, mean);
    }
    if (!ok) continue;
    // Keep birth order; require the desired means to be non-overlapping (≥ ROW_STEP
    // apart) in that order. If so, adopt them; else leave provisional slots.
    let strictly = true;
    for (let i = 1; i < order.length; i++) {
      if (desired.get(order[i]!)! - desired.get(order[i - 1]!)! < ROW_STEP - 1e-6) {
        strictly = false;
        break;
      }
    }
    if (strictly) {
      for (const id of order) y.set(id, desired.get(id)!);
    }
  }

  // --- Assemble placed nodes ----------------------------------------------
  const rawX = new Map<string, number>();
  for (const id of drawable) rawX.set(id, xForGen(generation.get(id)!));

  // Normalize both axes so the tightest bounding box (card edges) starts at 0.
  const drawnIds = [...drawable];
  let minX = Infinity;
  let minY = Infinity;
  for (const id of drawnIds) {
    minX = Math.min(minX, rawX.get(id)!);
    minY = Math.min(minY, y.get(id)!);
  }
  if (!isFinite(minX)) minX = 0;
  if (!isFinite(minY)) minY = 0;
  const offsetX = -minX + NODE_W / 2;
  const offsetY = -minY + NODE_H / 2;

  const placed: PlacedNode[] = drawnIds
    .map((id) => ({
      personId: id,
      x: rawX.get(id)! + offsetX,
      y: y.get(id)! + offsetY,
      generation: generation.get(id)!,
      node: nodeById.get(id)!,
    }))
    .sort((a, b) =>
      a.generation !== b.generation
        ? a.generation - b.generation
        : a.y !== b.y
          ? a.y - b.y
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
      x: a.x, // partners share a generation ⇒ same x column
      y: (a.y + b.y) / 2,
    });
  }

  // --- Connectors ---------------------------------------------------------
  const connectors: Connector[] = [];
  // Descent (horizontal axis): a parent (smaller generation) sits to the RIGHT of
  // its child, so the connector runs from the parent's LEFT edge to the child's
  // RIGHT edge, elbowed via a mid-X.
  for (const e of sortedEdges) {
    if (e.edgeType !== "parent_of") continue;
    const p = posOf.get(e.personAId);
    const c = posOf.get(e.personBId);
    if (!p || !c) continue;
    const px = p.x - NODE_W / 2; // parent's child-facing (LEFT) edge
    const py = p.y;
    const cx = c.x + NODE_W / 2; // child's parent-facing (RIGHT) edge
    const cy = c.y;
    const midX = (px + cx) / 2;
    connectors.push({
      kind: "descent",
      d: `M ${px} ${py} L ${midX} ${py} L ${midX} ${cy} L ${cx} ${cy}`,
    });
  }
  // Partner (vertical): the two cards share an x column and differ in y. Link runs
  // from the lower card's TOP edge to the upper card's BOTTOM edge.
  for (const u of unions) {
    const a = posOf.get(u.aPersonId)!;
    const b = posOf.get(u.bPersonId)!;
    const upper = a.y < b.y ? a : b;
    const lower = a.y < b.y ? b : a;
    connectors.push({
      kind: "partner",
      d: `M ${lower.x} ${lower.y - NODE_H / 2} L ${upper.x} ${upper.y + NODE_H / 2}`,
    });
  }

  // --- Per-edge affordances (collapse / expand / fetch) -------------------
  // Exactly ONE affordance per (node, direction) — never two glyphs on the same edge. State per edge:
  //   ANCESTOR (RIGHT) edge, for a drawn node with id and loadedParents / drawnParents:
  //     • node ∈ collapsedAncestors AND it has parents to show (loaded or hidden) → "expand".
  //     • else drawnParents.length > 0 (a drawn branch exists) → "collapse".
  //     • else undrawn parents exist (hasHiddenParents, or loaded-but-not-drawn) → "fetch".
  //       (This "fetch" is what preserves Finding 1: a loaded-but-undrawn parent yields a fetch caret,
  //       NOT an EmptyParentSlot, so activating it can never mint a duplicate parent.)
  //     • else (zero loaded parents and no hidden) → NO affordance; the EmptyParentSlot fires instead.
  //   DESCENDANT (LEFT) edge mirrors the above with children / collapsedChildren / hasHiddenChildren.
  const affordances: EdgeAffordance[] = [];
  for (const p of placed) {
    const id = p.personId;
    const n = p.node;

    // Ancestor (right) edge.
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
        affordances.push({ direction: "ancestors", personId: id, x: p.x + NODE_W / 2, y: p.y, state });
      }
    }

    // Descendant (left) edge.
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
        affordances.push({ direction: "descendants", personId: id, x: p.x - NODE_W / 2, y: p.y, state });
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
  // NO parent recorded at all (truly the add-parent frontier / bridge creation point), on the ancestor
  // (RIGHT) edge. Uses the UNFILTERED loaded-parent count, not the drawn count: a node that has a
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
        x: p.x + NODE_W / 2,
        y: p.y,
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
