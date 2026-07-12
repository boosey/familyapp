// Pure, dependency-free layout for the visual family tree (ADR-0016 tree renderer, Approach A).
// SHARED CONTRACT (Stage-0 stub). Implemented by Track-B "B-layout".
// See docs/superpowers/specs/2026-07-12-kinship-tree-viz-design.md §6.
//
// NOTE: named `tree-layout.ts` (not `layout.ts`) because `layout.*` is a reserved Next.js App Router
// file convention. This module imports TYPES ONLY — no DB, no React — so it is safe to run on server
// or client and trivial to unit-test. Do not add runtime dependencies here.

import type { KinshipTreeData, ResolvedKinshipEdge, TreeNode } from "@chronicle/core";

/**
 * What the user has revealed/collapsed beyond the default bounded window. The layout is a pure
 * function of (nodes, edges, root, expansion) — it re-runs on whatever node/edge set is present;
 * fetching more nodes at a boundary is the client's job (TreeCanvas), not the layout's.
 */
export interface ExpansionState {
  /** Nodes whose hidden parents have been revealed. */
  expandedParents: ReadonlySet<string>;
  /** Nodes whose hidden children have been revealed. */
  expandedChildren: ReadonlySet<string>;
  /** Nodes whose ancestor subtree the user has collapsed (per-box, top caret). */
  collapsedAncestors: ReadonlySet<string>;
  /** Couples (by {@link coupleKey}) whose descendant subtree the user has collapsed (bottom caret). */
  collapsedDescendants: ReadonlySet<string>;
}

export const EMPTY_EXPANSION: ExpansionState = {
  expandedParents: new Set(),
  expandedChildren: new Set(),
  collapsedAncestors: new Set(),
  collapsedDescendants: new Set(),
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
 * An interactive per-box caret the canvas renders as a medium-weight chevron.
 *
 * `ancestors` sits on the TOP edge of a node that has parents; `descendants` sits on the BOTTOM
 * edge of a couple (one per drawn couple, centered on the union) or a lone parent.
 */
export interface Affordance {
  kind: "ancestors" | "descendants";
  /** ancestors: the person id. descendants: the {@link coupleKey} of the couple (or lone person). */
  targetId: string;
  /** The person to fetch FROM when expanding a boundary (the node that owns hidden kin). */
  fetchPersonId: string;
  x: number;
  y: number;
  /** true ⇒ the subtree is drawn (chevron points toward collapse); false ⇒ collapsed. */
  expanded: boolean;
  /** true ⇒ expanding needs a server fetch (a boundary node with unloaded kin). */
  requiresFetch: boolean;
}

export interface TreeLayout {
  placed: PlacedNode[];
  unions: PlacedUnion[];
  connectors: Connector[];
  affordances: Affordance[];
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
// right, y grows down. All emitted coordinates are node CENTERS in px, and are
// normalized so the tightest bounding box starts at (0,0) with NODE_W/2 and
// NODE_H/2 padding — i.e. every node card fits inside `bounds`. Units are px.
// ---------------------------------------------------------------------------

const NODE_W = 120; // node card width (px)
export const NODE_H = 72; // node card height (px)
const H_GAP = 40; // horizontal gap between sibling/adjacent node cards
const V_GAP = 96; // vertical gap between generation rows (card edge to edge)

const COL_STEP = NODE_W + H_GAP; // center-to-center horizontal step within a row
const ROW_STEP = NODE_H + V_GAP; // center-to-center vertical step between rows

const DEFAULT_WINDOW_UP = 2;
const DEFAULT_WINDOW_DOWN = 2;

/** The default bounded neighborhood: ±2 generations from root (spec §5/§6). */
export const DEFAULT_LAYOUT_WINDOW = {
  up: DEFAULT_WINDOW_UP,
  down: DEFAULT_WINDOW_DOWN,
} as const;

/** Stable normalized key for an edge, used for deterministic ordering & dedup. */
function edgeKey(e: ResolvedKinshipEdge): string {
  return `${e.edgeType}:${e.personAId}:${e.personBId}`;
}

/**
 * Compute node positions, connector geometry, and expand/collapse affordances for the current
 * node/edge set rooted at `rootPersonId`. Deterministic (stable ordering) so identical data always
 * lays out identically.
 *
 * Pure & dependency-free. See spec §6.
 */
export function computeTreeLayout(input: LayoutInput): TreeLayout {
  const { rootPersonId, expansion } = input;

  // --- Index nodes & edges deterministically -----------------------------
  // Dedup by personId / edgeKey; sort by id/key so downstream iteration order
  // never depends on input ordering (determinism discipline, spec §6).
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
  // parent_of: A parent, B child. partnered_with: A/B partners (same gen).
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
  // parent = gen-1, child = gen+1, partner = same gen. First-seen generation
  // wins (BFS ⇒ shortest hop count; deterministic because we drain the queue
  // in insertion order and neighbors are already sorted).
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
      // Deterministic neighbor order: by personId.
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
  // Default window ±2 from root. A node beyond the window is drawn only when it
  // is reachable through a chain of expanded boundary nodes. A collapsed
  // generation removes its whole row.
  const drawable = new Set<string>();
  {
    // BFS again, but only follow into a node beyond the window when the current
    // node's expansion permits it. Start from root's reachable set with gens.
    const reachable = [...generation.keys()];
    // Determine per-node whether it is within window, honoring expansion chains.
    // We do a fixpoint expansion: a node at |gen| beyond window is included iff
    // some drawn adjacent node in the pull-direction expanded toward it.
    const inWindow = (g: number) => g >= -DEFAULT_WINDOW_UP && g <= DEFAULT_WINDOW_DOWN;

    // Seed with in-window nodes.
    for (const id of reachable) {
      if (inWindow(generation.get(id)!)) drawable.add(id);
    }
    // Iteratively pull in revealed boundary kin until fixpoint.
    let changed = true;
    while (changed) {
      changed = false;
      // Reveal parents of a node when the node is drawn AND expandedParents has it.
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
        // Partners of a drawn node are ALWAYS shown adjacent as a union — a
        // partner is (by BFS) the same generation as `id`, so if `id`'s row is
        // drawn the partner belongs on it too. This holds even when `id` was
        // itself revealed beyond the default window via expansion: the union
        // rule (spec §6) is unconditional, not scoped to the default window.
        for (const s of partnersOf.get(id) ?? []) {
          if (generation.has(s) && !drawable.has(s)) {
            drawable.add(s);
            changed = true;
          }
        }
      }
    }
    // Apply per-box collapse cuts. Re-walk the drawable graph from root, but
    // refuse to cross a cut: a node in `collapsedAncestors` blocks the walk from
    // ascending into its parents; a couple in `collapsedDescendants` blocks the
    // walk from descending into that couple's children. Any drawable node no
    // longer reached from root is removed (prunes the whole cut subtree).
    {
      const cutUp = expansion.collapsedAncestors;
      const cutDown = expansion.collapsedDescendants;
      const keep = new Set<string>();
      const stack: string[] = nodeById.has(rootPersonId) ? [rootPersonId] : [];
      while (stack.length) {
        const cur = stack.pop()!;
        if (keep.has(cur) || !drawable.has(cur)) continue;
        keep.add(cur);
        if (!cutUp.has(cur))
          for (const p of parentsOf.get(cur) ?? []) if (drawable.has(p)) stack.push(p);
        const partners = partnersOf.get(cur) ?? [];
        for (const s of partners) if (drawable.has(s)) stack.push(s);
        const myCoupleKeys = [coupleKey(cur), ...partners.map((s) => coupleKey(cur, s))];
        const downCollapsed = myCoupleKeys.some((k) => cutDown.has(k));
        if (!downCollapsed)
          for (const c of childrenOf.get(cur) ?? []) if (drawable.has(c)) stack.push(c);
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

  // Order within a generation: keep unions (partner pairs) adjacent, group
  // siblings under shared parents, otherwise by personId. We build an ordered
  // list per generation greedily but deterministically.
  const orderedByGen = new Map<number, string[]>();
  for (const g of drawnGens) {
    const members = (byGen.get(g) ?? []).slice().sort();
    const placed: string[] = [];
    const seen = new Set<string>();
    for (const id of members) {
      if (seen.has(id)) continue;
      placed.push(id);
      seen.add(id);
      // Immediately follow with any drawn partners (side-by-side unions),
      // in deterministic id order.
      const partners = (partnersOf.get(id) ?? [])
        .filter((p) => drawable.has(p) && generation.get(p) === g && !seen.has(p))
        .sort();
      for (const p of partners) {
        placed.push(p);
        seen.add(p);
      }
    }
    orderedByGen.set(g, placed);
  }

  // --- Assign x positions -------------------------------------------------
  // Strategy (deterministic): lay each generation top→down so parent x is
  // settled before children. Positioning is done at the CLUSTER level, where a
  // cluster is a maximal run of partner-connected nodes drawn in the same
  // generation (a union, or a chain of serial partners) — kept contiguous in
  // `orderedByGen`. Placing a union as ONE block is what keeps partners adjacent
  // even when each spouse has their OWN drawn parents at different x (in-laws).
  //
  // Each node gets a DESIRED center: a child's is its drawn parents' midpoint; a
  // node with no drawn parent keeps its slot. A cluster's desired center is the
  // mean of its members' desired centers; its members are laid out contiguously
  // (COL_STEP apart) centered on that mean. Clusters are then swept left→right in
  // desired-center order, pushed right only to keep the minimum gap between the
  // last node of one cluster and the first of the next.
  const x = new Map<string, number>();

  for (const g of drawnGens) {
    const order = orderedByGen.get(g)!;
    if (order.length === 0) continue;

    // Provisional slot for nodes lacking a drawn parent (keeps disconnected
    // members in a stable left→right order).
    const slot = new Map<string, number>();
    order.forEach((id, i) => slot.set(id, i * COL_STEP));

    // Desired center per node.
    const desired = new Map<string, number>();
    for (const id of order) {
      const drawnParents = (parentsOf.get(id) ?? []).filter(
        (p) => drawable.has(p) && x.has(p),
      );
      if (drawnParents.length > 0) {
        const sum = drawnParents.reduce((acc, p) => acc + x.get(p)!, 0);
        desired.set(id, sum / drawnParents.length);
      } else {
        desired.set(id, slot.get(id)!);
      }
    }

    // Partition the row into partner-connected clusters, preserving `order`
    // (adjacency) within each cluster. Union-find over drawn same-gen partners.
    const clusterOf = new Map<string, number>();
    let nextCluster = 0;
    for (const id of order) {
      if (clusterOf.has(id)) continue;
      // Flood-fill this node's drawn same-generation partner component.
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

    // Cluster member lists in row order (keeps unions adjacent & deterministic).
    const clusters = new Map<number, string[]>();
    for (const id of order) {
      const cid = clusterOf.get(id)!;
      const arr = clusters.get(cid);
      if (arr) arr.push(id);
      else clusters.set(cid, [id]);
    }

    // Per-cluster desired center = mean of member desired centers. A cluster is
    // one positioning block that stays contiguous (unions never split).
    const clusterList = [...clusters.entries()].map(([cid, members]) => ({
      cid,
      members,
      center: members.reduce((acc, m) => acc + desired.get(m)!, 0) / members.length,
    }));

    // Siblings that share the SAME desired center (e.g. several children of the
    // same parent/union, each its own cluster) must be spread symmetrically
    // AROUND that center so the group stays centered on the parent — not stacked
    // starting at it. Group clusters by center, then assign each cluster a
    // "target center" that spreads the group symmetrically (in deterministic
    // first-member id order). Non-shared centers are unchanged.
    const byCenter = new Map<number, typeof clusterList>();
    for (const cl of clusterList) {
      const arr = byCenter.get(cl.center);
      if (arr) arr.push(cl);
      else byCenter.set(cl.center, [cl]);
    }
    const targetCenter = new Map<number, number>(); // cid -> spread center
    for (const [center, group] of byCenter) {
      group.sort((a, b) => (a.members[0]! < b.members[0]! ? -1 : 1));
      // Total span needed by the group: sum of member counts, minus shared gaps.
      const totalNodes = group.reduce((acc, cl) => acc + cl.members.length, 0);
      const span = (totalNodes - 1) * COL_STEP;
      let walk = center - span / 2; // x of the first node in the group
      for (const cl of group) {
        const w = (cl.members.length - 1) * COL_STEP;
        targetCenter.set(cl.cid, walk + w / 2);
        walk += cl.members.length * COL_STEP;
      }
    }

    // Sweep clusters in ascending target-center order (first-member id tiebreak
    // for determinism), placing members contiguously and pushing right only to
    // keep the minimum gap between adjacent clusters.
    clusterList.sort((a, b) => {
      const ca = targetCenter.get(a.cid)!;
      const cb = targetCenter.get(b.cid)!;
      if (ca !== cb) return ca - cb;
      return a.members[0]! < b.members[0]! ? -1 : 1;
    });
    let cursor = -Infinity; // x of the last placed node
    for (const cl of clusterList) {
      const width = (cl.members.length - 1) * COL_STEP;
      let left = targetCenter.get(cl.cid)! - width / 2;
      if (left < cursor + COL_STEP) left = cursor + COL_STEP;
      cl.members.forEach((id, k) => x.set(id, left + k * COL_STEP));
      cursor = left + width;
    }
  }

  // --- Normalize to non-negative coordinates -----------------------------
  const drawnIds = [...drawable];
  let minX = Infinity;
  for (const id of drawnIds) minX = Math.min(minX, x.get(id)!);
  if (!isFinite(minX)) minX = 0;
  const offsetX = -minX + NODE_W / 2; // leftmost card's left edge → 0
  // Baseline row is the topmost drawn generation.
  const minGen = drawnGens.length ? Math.min(...drawnGens) : 0;
  const yForGen = (g: number) => (g - minGen) * ROW_STEP + NODE_H / 2;

  const placed: PlacedNode[] = drawnIds
    .map((id) => ({
      personId: id,
      x: x.get(id)! + offsetX,
      y: yForGen(generation.get(id)!),
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
      y: a.y, // partners share a generation ⇒ same y
    });
  }

  // --- Connectors ---------------------------------------------------------
  const connectors: Connector[] = [];
  // Descent: parent bottom → child top. Simple elbow path.
  for (const e of sortedEdges) {
    if (e.edgeType !== "parent_of") continue;
    const p = posOf.get(e.personAId);
    const c = posOf.get(e.personBId);
    if (!p || !c) continue;
    const px = p.x;
    const py = p.y + NODE_H / 2;
    const cx = c.x;
    const cy = c.y - NODE_H / 2;
    const midY = (py + cy) / 2;
    connectors.push({
      kind: "descent",
      d: `M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cy}`,
    });
  }
  // Partner: straight horizontal link between the two cards.
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

  // --- Affordances (per-box carets) --------------------------------------
  // ancestors: TOP-edge caret on any node that has parents (drawn, or hidden at a
  //   boundary). `expanded` reflects whether any parent is currently drawn.
  // descendants: BOTTOM-edge caret, ONE per drawn couple (centered on the union)
  //   or per lone parent, on any node/couple that has children (drawn or hidden).
  const affordances: Affordance[] = [];
  const handledDescendant = new Set<string>();
  for (const p of placed) {
    const id = p.personId;
    const n = p.node;

    // --- ancestor caret ---
    const parents = parentsOf.get(id) ?? [];
    const hasParents = parents.length > 0 || n.hasHiddenParents;
    if (hasParents) {
      const anyParentDrawn = parents.some((pp) => drawable.has(pp));
      // A fetch is required only when no parent is drawn AND kin are unloaded.
      const requiresFetch = !anyParentDrawn && n.hasHiddenParents;
      affordances.push({
        kind: "ancestors",
        targetId: id,
        fetchPersonId: id,
        x: p.x,
        y: p.y - NODE_H / 2,
        expanded: anyParentDrawn,
        requiresFetch,
      });
    }

    // --- descendant caret(s): attributed to the SPECIFIC union -----------
    // A descendant caret covers exactly the children a union OWNS, so a childless
    // union never gets one even when a member has children via a DIFFERENT union
    // (serial-partner bug). Children partition by co-parent:
    //   • A child SHARED by a drawn couple (a,b) — parents(child) ⊇ {a,b} — is
    //     owned by the couple caret, keyed coupleKey(a,b), emitted once.
    //   • A child of `id` with NO drawn co-parent among id's partners (a single
    //     drawn parent), plus id's HIDDEN children, is owned by the lone-node
    //     caret, keyed coupleKey(id).
    // This guarantees: (1) childless unions get no caret, (2) every drawn child is
    // claimed by exactly one caret, so nothing is orphaned.
    // Unmodeled case: a child shared by two DRAWN co-parents who are NOT partnered
    // has no couple to attribute to; it falls through to each parent's lone caret
    // (drawn twice). That configuration is out of scope for v1 (co-parents are
    // modeled as partners).
    const drawnPartners = (partnersOf.get(id) ?? []).filter((s) => posOf.has(s)).sort();
    const myChildren = childrenOf.get(id) ?? [];

    // (a) One caret per drawn couple, for children the couple SHARES.
    for (const s of drawnPartners) {
      const ck = coupleKey(id, s);
      if (handledDescendant.has(ck)) continue;
      const shared = myChildren.filter((c) => (parentsOf.get(c) ?? []).includes(s));
      if (shared.length === 0) continue; // childless union ⇒ no caret
      handledDescendant.add(ck);
      const anyChildDrawn = shared.some((c) => drawable.has(c));
      affordances.push({
        kind: "descendants",
        targetId: ck,
        fetchPersonId: id,
        x: (posOf.get(id)!.x + posOf.get(s)!.x) / 2,
        y: p.y + NODE_H / 2,
        expanded: anyChildDrawn,
        requiresFetch: false, // shared children are already loaded (both parents drawn)
      });
    }

    // (b) Lone-node caret for id's children with no drawn co-parent, plus hidden.
    const lk = coupleKey(id);
    if (!handledDescendant.has(lk)) {
      const soloChildren = myChildren.filter(
        (c) => !drawnPartners.some((s) => (parentsOf.get(c) ?? []).includes(s)),
      );
      const hidden = n.hasHiddenChildren;
      if (soloChildren.length > 0 || hidden) {
        handledDescendant.add(lk);
        const anyChildDrawn = soloChildren.some((c) => drawable.has(c));
        affordances.push({
          kind: "descendants",
          targetId: lk,
          fetchPersonId: id,
          x: p.x,
          y: p.y + NODE_H / 2,
          expanded: anyChildDrawn,
          requiresFetch: !anyChildDrawn && hidden,
        });
      }
    }
  }
  // Deterministic affordance order: kind, then targetId, then position.
  affordances.sort((a, b) =>
    a.kind !== b.kind
      ? a.kind < b.kind
        ? -1
        : 1
      : a.targetId !== b.targetId
        ? a.targetId < b.targetId
          ? -1
          : 1
        : 0,
  );

  // --- Bounds -------------------------------------------------------------
  // Enclose both node cards AND affordance glyphs — a descendant caret sits a
  // half-card below the last drawn row, so bounds must account for it or the
  // canvas would clip that control.
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

  return { placed, unions, connectors, affordances, bounds: { width, height } };
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
