// Pure, dependency-free layout for the ego-centric visual family tree (spec 2026-07-13, ADR-0016/0017).
//
// Mental model (spec §1): a fixed, pannable canvas centered on a FIXED focus person. There is NO
// re-rooting and NO selection state. Generations stack VERTICALLY — ancestors above (smaller y),
// descendants below (larger y); within-generation stacking is horizontal (x). Each identified card
// owns up to three directional affordances (parents ↑, siblings ↔, children ↓): a CARET when kin
// exist in that direction, or a "+" when none do. The focus only seeds the initial framing and initial
// expansion — it is not selectable, not re-rootable, carries no visual marker.
//
// This module imports TYPES ONLY — no DB, no React — so it is safe on server or client and trivial to
// unit-test. Do not add runtime dependencies here.
//
// NOTE: named `tree-layout.ts` (not `layout.ts`) because `layout.*` is a reserved Next.js App Router
// file convention.

import type { KinshipTreeData, ResolvedKinshipEdge, TreeNode } from "@chronicle/core";

// ---------------------------------------------------------------------------
// Expansion state
// ---------------------------------------------------------------------------

/**
 * What the user has expanded/collapsed relative to the focus-seeded initial expansion. The layout is a
 * pure function of (nodes, edges, focus, expansion). Fetching more nodes at a boundary is the client's
 * background job (TreeCanvas), not the layout's.
 *
 * Directions are per the caret model (spec §3):
 *   - `expandedParents` — a person whose parent-couple the user revealed (per-person, ↑).
 *   - `expandedSiblings` — a person whose siblings the user fanned out (per-person, ↔).
 *   - `expandedChildren` — a COUPLE (coupleKey) whose children the user revealed (per-couple, ↓).
 *   - the `collapsed*` sets are the inverse: a direction the user pruned back after it was open by
 *     default (e.g. the focus's initially-expanded parents/children).
 */
export interface ExpansionState {
  expandedParents: ReadonlySet<string>;
  expandedSiblings: ReadonlySet<string>;
  /** Keyed by {@link coupleKey}. */
  expandedChildren: ReadonlySet<string>;
  collapsedParents: ReadonlySet<string>;
  collapsedSiblings: ReadonlySet<string>;
  /** Keyed by {@link coupleKey}. */
  collapsedChildren: ReadonlySet<string>;
}

export const EMPTY_EXPANSION: ExpansionState = {
  expandedParents: new Set(),
  expandedSiblings: new Set(),
  expandedChildren: new Set(),
  collapsedParents: new Set(),
  collapsedSiblings: new Set(),
  collapsedChildren: new Set(),
};

/**
 * Stable key for a couple (or a lone parent). Order-independent: `coupleKey(a,b) === coupleKey(b,a)`.
 * A single parent keys to their own id.
 */
export function coupleKey(a: string, b?: string | null): string {
  if (!b) return a;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ---------------------------------------------------------------------------
// Output types — THE SHARED CONTRACT (canvas renders exactly these).
// ---------------------------------------------------------------------------

export interface PlacedNode {
  personId: string;
  x: number;
  y: number;
  /** Generation relative to the focus (0 = focus row, negative = ancestors, positive = descendants). */
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
  /** SVG path data for a descent bus or a partner link. */
  d: string;
  kind: "descent" | "partner";
}

/** The three directions a card's affordance can point. */
export type AffordanceDirection = "parents" | "siblings" | "children";

/**
 * One directional affordance drawn in a card's outer gutter (spec §3). Exactly one per (owner,
 * direction). `kind` decides the glyph:
 *   - `"caret"` — kin exist in the data; activating expands/collapses (client-only, instant).
 *       `expanded` says which way the caret currently points.
 *   - `"add"` — no kin in that direction; activating starts add-in-that-direction (navigates).
 *
 * Ownership:
 *   - `parents` / `siblings` are PER-PERSON — `ownerId` is the person; `coupleId` is undefined.
 *   - `children` is PER-COUPLE — `ownerId` is the drawn "anchor" partner (left card), `coupleId` is the
 *     {@link coupleKey}; the caret sits under the couple's descent bus.
 *
 * `side` is meaningful only for `siblings` (which border the caret hugs). For `parents`/`children`
 * it is always `"center"`.
 */
export interface Affordance {
  direction: AffordanceDirection;
  kind: "caret" | "add";
  /** Whether a `"caret"` is currently expanded (kin drawn). Ignored for `"add"`. */
  expanded: boolean;
  /** The person a `parents`/`siblings` affordance belongs to, or the anchor of a `children` couple. */
  ownerId: string;
  /** For `children`: the {@link coupleKey} of the couple whose bus this hangs under. */
  coupleId?: string;
  /** For `siblings`: which side of the card the caret hugs. `center` otherwise. */
  side: "left" | "right" | "center";
  x: number;
  y: number;
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
  /** The fixed focus person. Seeds generation, initial framing, and (with expansion) initial expansion. */
  focusPersonId: string;
  expansion: ExpansionState;
}

// ---------------------------------------------------------------------------
// Geometry constants. SVG-native coords: (0,0) top-left, x right, y down.
// Generation → y (ancestors up, descendants down); within-generation → x.
// Emitted coordinates are node CENTERS in px, normalized so the tightest box
// (incl. gutter affordances) starts at (0,0).
// ---------------------------------------------------------------------------

export const NODE_W = 150; // card width (px)
export const NODE_H = 168; // card height (px) — avatar · name · dates, uniform
const CROSS_H_GAP = 26; // horizontal gap between stacked same-generation cards
const PARTNER_GAP = 7; // tight gap inside a partnership (adjacent) — partners sit ~half as far apart
const GEN_V_GAP = 78; // vertical gap between generation rows (room for gutter carets + bus)

const CROSS_STEP = NODE_W + CROSS_H_GAP; // center-to-center step for non-partner neighbors
const PARTNER_STEP = NODE_W + PARTNER_GAP; // center-to-center step inside a partnership
const GEN_STEP = NODE_H + GEN_V_GAP; // center-to-center vertical step between rows
/** Drop below the parents' bottom edge where the U's floor sits and the vertical riser begins. The
 *  children caret is placed HERE (the U/riser junction) rather than crammed against the card bottoms. */
const JOIN_DROP = GEN_V_GAP * 0.35;

/**
 * Distance from the card edge to a gutter caret/"+" CENTER (px). Set so the 22px glyph rendered by the
 * canvas OVERLAPS the card by ~25%: with radius 11, a center 5.5px outside the edge leaves 5.5px (25% of
 * the 22px glyph) sitting over the card. Keep in sync with the button `size` in tree-canvas.tsx.
 */
export const CARET_GAP = 5.5;
/** Half-size of a caret/"+" glyph, reserved as padding so a side/edge affordance never clips. */
const CARET_HALF = 12;
/** Side padding reserved so a left-side sibling caret stays within bounds. */
const SIDE_PAD = CARET_GAP + CARET_HALF;
/** Extra headroom above the top row so ancestor-gutter affordances stay within bounds. */
const TOP_PAD = CARET_GAP + CARET_HALF + 8;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function pushUnique(m: Map<string, string[]>, k: string, v: string): void {
  const arr = m.get(k);
  if (arr) {
    if (!arr.includes(v)) arr.push(v);
  } else m.set(k, [v]);
}

/** Stable normalized key for an edge, for deterministic ordering & dedup. */
function edgeKey(e: ResolvedKinshipEdge): string {
  return `${e.edgeType}:${e.personAId}:${e.personBId}`;
}

// ---------------------------------------------------------------------------
// computeTreeLayout
// ---------------------------------------------------------------------------

/**
 * Compute node positions, connectors, and the per-direction caret/"+" affordances for the current
 * node/edge set anchored on `focusPersonId`. Deterministic — identical data lays out identically. Pure.
 */
export function computeTreeLayout(input: LayoutInput): TreeLayout {
  const { focusPersonId, expansion } = input;

  // --- Index nodes & edges deterministically -----------------------------
  const nodeById = new Map<string, TreeNode>();
  for (const n of input.nodes) if (!nodeById.has(n.personId)) nodeById.set(n.personId, n);
  const sortedNodeIds = [...nodeById.keys()].sort();

  const edgeByKey = new Map<string, ResolvedKinshipEdge>();
  for (const e of input.edges) {
    const k = edgeKey(e);
    if (!edgeByKey.has(k)) edgeByKey.set(k, e);
  }
  const sortedEdges = [...edgeByKey.values()].sort((a, b) =>
    edgeKey(a) < edgeKey(b) ? -1 : edgeKey(a) > edgeKey(b) ? 1 : 0,
  );

  // Adjacency (only edges whose BOTH endpoints are loaded nodes). Ordering of `partnerEntry` follows
  // the deterministic edge sort (created_at then id via the normalized (A,B) convention) so partner
  // placement is stable.
  const parentsOf = new Map<string, string[]>(); // child -> parents
  const childrenOf = new Map<string, string[]>(); // parent -> children
  const partnersOf = new Map<string, string[]>(); // person -> partners (entry-order)

  for (const e of sortedEdges) {
    if (!nodeById.has(e.personAId) || !nodeById.has(e.personBId)) continue;
    if (e.edgeType === "parent_of") {
      pushUnique(childrenOf, e.personAId, e.personBId);
      pushUnique(parentsOf, e.personBId, e.personAId);
    } else {
      pushUnique(partnersOf, e.personAId, e.personBId);
      pushUnique(partnersOf, e.personBId, e.personAId);
    }
  }

  const parentsList = (id: string) => parentsOf.get(id) ?? [];
  const childrenList = (id: string) => childrenOf.get(id) ?? [];
  const partnersList = (id: string) => partnersOf.get(id) ?? [];

  /** The (at most one, v1) partner of `id` that is a loaded node, or null. */
  const partnerOf = (id: string): string | null => {
    const ps = partnersList(id);
    return ps.length > 0 ? ps[0]! : null;
  };

  /** Siblings of `id` = others sharing ≥1 loaded parent (derived, ADR-0016). */
  const siblingsOf = (id: string): string[] => {
    const out = new Set<string>();
    for (const p of parentsList(id)) for (const c of childrenList(p)) if (c !== id) out.add(c);
    return [...out];
  };

  /** The shared-children set of `id`+partner (the couple's kids), or `id`'s own if single. */
  const coupleChildren = (id: string, partner: string | null): string[] => {
    if (!partner) return childrenList(id);
    // Children with BOTH id and partner as parents (v1: shared set).
    const mine = new Set(childrenList(id));
    const out: string[] = [];
    for (const c of childrenList(partner)) if (mine.has(c)) out.push(c);
    // Fall back to the union if the model hasn't linked both parents (defensive).
    if (out.length === 0) {
      const u = new Set([...childrenList(id), ...childrenList(partner)]);
      return [...u];
    }
    return out;
  };

  // --- Generation assignment via BFS from focus --------------------------
  const generation = new Map<string, number>();
  if (nodeById.has(focusPersonId)) {
    generation.set(focusPersonId, 0);
    const queue: string[] = [focusPersonId];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++]!;
      const g = generation.get(cur)!;
      const neighbors: Array<[string, number]> = [];
      for (const p of parentsList(cur)) neighbors.push([p, g - 1]);
      for (const c of childrenList(cur)) neighbors.push([c, g + 1]);
      for (const s of partnersList(cur)) neighbors.push([s, g]);
      neighbors.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      for (const [id, ng] of neighbors) {
        if (!generation.has(id)) {
          generation.set(id, ng);
          queue.push(id);
        }
      }
    }
  }

  // --- Determine DRAWN set via the ego-centric expansion walk ------------
  // Start from the focus. The focus's parents+children are shown by default (initial expansion),
  // unless collapsed. From any drawn person, a direction is "open" when expansion says so:
  //   parents open  ⇔ (person === focus OR person ∈ expandedParents) AND person ∉ collapsedParents
  //   siblings open ⇔ person ∈ expandedSiblings AND person ∉ collapsedSiblings
  //   children open ⇔ (couple === focus's couple OR coupleKey ∈ expandedChildren)
  //                    AND coupleKey ∉ collapsedChildren
  // Partners of a drawn person are always drawn adjacent (a union, not an expansion).
  const drawn = new Set<string>();
  // How each drawn person was reached (its spanning-tree discovery edge, ADR-0018). Caret OWNERSHIP
  // keys off this: a person reached "as an individual" (`anchor` / `partner` / `parent-caret`) owns
  // its own parents ↑ and siblings ↔ affordances; a `child-set` / `sibling-set` member owns neither
  // (the nearer node that revealed the set owns that edge). First discovery wins (spec §8), and the
  // walk visits partner → parents → siblings → children so the priority is deterministic.
  type DiscoveredVia = "anchor" | "partner" | "parent-caret" | "child-set" | "sibling-set";
  const discoveredVia = new Map<string, DiscoveredVia>();
  {
    const focusPartner = partnerOf(focusPersonId);
    const focusCoupleKey = coupleKey(focusPersonId, focusPartner);

    const parentsOpen = (id: string): boolean => {
      const base = id === focusPersonId || expansion.expandedParents.has(id);
      return base && !expansion.collapsedParents.has(id);
    };
    const siblingsOpen = (id: string): boolean =>
      expansion.expandedSiblings.has(id) && !expansion.collapsedSiblings.has(id);
    const childrenOpen = (ck: string): boolean => {
      const base = ck === focusCoupleKey || expansion.expandedChildren.has(ck);
      return base && !expansion.collapsedChildren.has(ck);
    };

    const visit = (id: string, via: DiscoveredVia) => {
      if (!nodeById.has(id) || drawn.has(id)) return;
      drawn.add(id);
      discoveredVia.set(id, via);
      const partner = partnerOf(id);
      // Partner is always adjacent.
      if (partner && !drawn.has(partner)) visit(partner, "partner");

      if (parentsOpen(id)) {
        for (const p of parentsList(id)) visit(p, "parent-caret");
      }
      if (siblingsOpen(id)) {
        for (const s of siblingsOf(id)) visit(s, "sibling-set");
      }
      const ck = coupleKey(id, partner);
      if (childrenOpen(ck)) {
        for (const c of coupleChildren(id, partner)) visit(c, "child-set");
      }
    };

    if (nodeById.has(focusPersonId)) visit(focusPersonId, "anchor");
    // The above walk is order-sensitive only in traversal, not in output; re-run to a fixpoint so a
    // person reached late still gets its open directions expanded.
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of [...drawn].sort()) {
        const partner = partnerOf(id);
        const consider = (nid: string, via: DiscoveredVia) => {
          if (nodeById.has(nid) && !drawn.has(nid)) {
            visit(nid, via);
            changed = true;
          }
        };
        if (partner) consider(partner, "partner");
        if (parentsOpen(id)) for (const p of parentsList(id)) consider(p, "parent-caret");
        if (siblingsOpen(id)) for (const s of siblingsOf(id)) consider(s, "sibling-set");
        const ck = coupleKey(id, partner);
        if (childrenOpen(ck)) for (const c of coupleChildren(id, partner)) consider(c, "child-set");
      }
    }
  }

  const drawable = drawn; // alias for clarity below
  const isDrawn = (id: string) => drawable.has(id);

  // --- Group drawn nodes by generation -----------------------------------
  const byGen = new Map<number, string[]>();
  for (const id of sortedNodeIds) {
    if (!isDrawn(id)) continue;
    const g = generation.get(id)!;
    const arr = byGen.get(g);
    if (arr) arr.push(id);
    else byGen.set(g, [id]);
  }
  const drawnGens = [...byGen.keys()].sort((a, b) => a - b);

  const yForGen = (g: number) => g * GEN_STEP;

  // --- Horizontal (x) placement ------------------------------------------
  // Order each generation row by birthYear (nulls last, id tiebreak), keeping partner clusters
  // contiguous. Partners inside a cluster use the tighter PARTNER_STEP; between clusters CROSS_STEP.
  const x = new Map<string, number>();

  const cmpBirth = (a: string, b: string): number => {
    const ba = nodeById.get(a)!.birthYear;
    const bb = nodeById.get(b)!.birthYear;
    if (ba != null && bb != null) {
      if (ba !== bb) return ba - bb;
    } else if (ba != null) return -1;
    else if (bb != null) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  };

  // Deterministic partner ORDER within a couple (spec §5): man on the left; same-sex/unspecified by
  // entry order (edge sort already encodes created_at then id) then personId. Returns [left, right].
  const orderPartners = (a: string, b: string): [string, string] => {
    const sa = nodeById.get(a)!.sex;
    const sb = nodeById.get(b)!.sex;
    if (sa === "male" && sb !== "male") return [a, b];
    if (sb === "male" && sa !== "male") return [b, a];
    if (sa === "female" && sb !== "female") return [b, a]; // woman right
    if (sb === "female" && sa !== "female") return [a, b];
    // Same-sex / both unspecified: entry order via partnersOf(a) listing, then id.
    const idxA = partnersList(a).indexOf(b); // a's view of b
    const idxB = partnersList(b).indexOf(a);
    // Lower entry index sits left; fall back to id.
    if (idxA !== idxB) return idxA <= idxB ? [a, b] : [b, a];
    return a < b ? [a, b] : [b, a];
  };

  /**
   * The side a person's sibling caret hugs (spec §3), and the side their sibling fan pins to (§4).
   * ONE shared rule so the drawn caret and the fan never disagree:
   *   - drawn partner → POSITION side via `orderPartners` (left partner → left; right partner → right).
   *     Position-derived (not sex) so a same-sex/unspecified couple placed by entry-order fans to the
   *     side the caret is actually on.
   *   - single → sex: female → right; male/unspecified → left (deterministic default).
   * Position-independent (uses `orderPartners`, not `posOf`) so it is callable during x-placement.
   */
  const siblingSide = (id: string): "left" | "right" => {
    const partner = partnerOf(id);
    if (partner && isDrawn(partner) && generation.get(partner) === generation.get(id)) {
      return orderPartners(id, partner)[0] === id ? "left" : "right";
    }
    return nodeById.get(id)!.sex === "female" ? "right" : "left";
  };

  // Per generation, build clusters and lay them left→right.
  const orderedByGen = new Map<number, string[]>();
  // Record each drawn couple's [left,right] and their center x, for the descent bus + children caret.
  interface DrawnCouple {
    leftId: string;
    rightId: string | null; // null ⇒ single parent
    ck: string;
  }
  const couplesByCenter: DrawnCouple[] = [];

  for (const g of drawnGens) {
    const members = (byGen.get(g) ?? []).slice();

    // Partition into partner-connected clusters (drawn, same generation). v1: at most a pair.
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
        for (const s of partnersList(cur)) {
          if (isDrawn(s) && generation.get(s) === g && !clusterOf.has(s)) stack.push(s);
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

    // Order each cluster's members: a pair → [left,right] via orderPartners; a single → itself.
    const orderedClusters = [...clusters.values()].map((mem) => {
      if (mem.length === 2) {
        const [l, r] = orderPartners(mem[0]!, mem[1]!);
        return [l, r];
      }
      return mem.slice().sort(cmpBirth);
    });
    // Order clusters left→right by their senior (earliest-born) member.
    orderedClusters.sort((a, b) => {
      const seniorA = a.slice().sort(cmpBirth)[0]!;
      const seniorB = b.slice().sort(cmpBirth)[0]!;
      return cmpBirth(seniorA, seniorB);
    });

    const flat = orderedClusters.flat();
    orderedByGen.set(g, flat);
  }

  // --- Ego-side sibling fan (spec §4) ------------------------------------
  // For each person E whose siblings are expanded, reorder E's row so E is pinned at E's sibling-caret
  // side and E's drawn siblings fan OUTWARD from E with OLDEST FARTHEST (age reads monotonically away
  // from E). Siblings hang off the shared parent-couple's descent bus, so they stay a contiguous run in
  // the row; we splice the reordered run back where the group sat. Only touches the sibling group's
  // slots — other clusters in the row keep their positions.
  for (const anchor of [...expansion.expandedSiblings].sort()) {
    if (!isDrawn(anchor)) continue;
    const g = generation.get(anchor);
    if (g === undefined) continue;
    const row = orderedByGen.get(g);
    if (!row) continue;
    const sibs = siblingsOf(anchor).filter((s) => isDrawn(s));
    if (sibs.length === 0) continue;

    // E's caret side — the SHARED rule (position for a drawn partner, sex when single) so the fan pins
    // to exactly the side the sibling caret is drawn on, even for same-sex/unspecified couples. Siblings
    // fan OUTWARD from E on that side, OLDEST FARTHEST (age reads monotonically away from E).
    const side = siblingSide(anchor);
    const sibsOldestFirst = sibs.slice().sort(cmpBirth); // oldest (earliest birth) first

    const partner = partnerOf(anchor);
    const hasDrawnPartner =
      partner != null && isDrawn(partner) && generation.get(partner) === g;

    if (hasDrawnPartner) {
      // Coupled anchor: keep the couple [left,right] CONTIGUOUS and place the whole sibling run on E's
      // caret side, OUTSIDE the couple. Left partner → siblings to the LEFT; right partner → to the
      // RIGHT (matches the caret side). Each sibling travels together with its OWN drawn same-generation
      // partner (an in-law) as an indivisible [left,right] unit, so a fanned sibling's spouse is never
      // wedged away from them. Lift these units out of wherever birth-order left them and reinsert them
      // as one contiguous block hugging E on the caret side.
      const sibUnit = (s: string): string[] => {
        const sp = partnerOf(s);
        if (sp != null && sp !== anchor && isDrawn(sp) && generation.get(sp) === g) {
          return orderPartners(s, sp); // [left,right] — keep the in-law adjacent to the sibling
        }
        return [s];
      };
      // Units ordered oldest sibling → youngest. Flatten with dedup (defensive against a sibling whose
      // partner is also a sibling — out of scope, but must never duplicate a card in the row).
      const flattenDedup = (units: string[][]): string[] => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const u of units) for (const id of u) if (!seen.has(id)) (seen.add(id), out.push(id));
        return out;
      };
      const unitsOldestFirst = sibsOldestFirst.map(sibUnit);
      const block =
        side === "left"
          ? flattenDedup(unitsOldestFirst) // left→right: oldest…youngest, then E (oldest farthest-left)
          : flattenDedup(unitsOldestFirst.slice().reverse()); // E, then youngest…oldest (oldest far-right)
      const removeSet = new Set(block);
      const filtered = row.filter((id) => !removeSet.has(id));
      const anchorIdx = filtered.indexOf(anchor);
      if (anchorIdx === -1) continue;
      filtered.splice(side === "left" ? anchorIdx : anchorIdx + 1, 0, ...block);
      orderedByGen.set(g, filtered);
      continue;
    }

    // Single anchor (no drawn partner): permute in place within the group's existing slots. If E hugs
    // the LEFT, E occupies the left slot and siblings run right (youngest nearest E). If E hugs the
    // RIGHT, siblings run left and E sits at the far right.
    const group = new Set<string>([anchor, ...sibs]);
    const groupIdx = row.map((id, i) => ({ id, i })).filter((e) => group.has(e.id)).map((e) => e.i);
    if (groupIdx.length === 0) continue;
    const slots = groupIdx.slice().sort((a, b) => a - b); // ascending row positions to reuse
    let ordered: string[];
    if (side === "left") {
      // left→right: E, then youngest→oldest so oldest is farthest right.
      ordered = [anchor, ...sibsOldestFirst.slice().reverse()];
    } else {
      // left→right: oldest→youngest, then E at the far right.
      ordered = [...sibsOldestFirst, anchor];
    }
    // Splice `ordered` back into the row at the group's original slots (contiguous run).
    for (let k = 0; k < slots.length && k < ordered.length; k++) {
      row[slots[k]!] = ordered[k]!;
    }
  }

  // Assign x with partner-aware stepping. Walk each row left→right; a partner-adjacent step uses the
  // tighter PARTNER_STEP, others CROSS_STEP.
  for (const g of drawnGens) {
    const order = orderedByGen.get(g)!;
    let cursor = 0;
    order.forEach((id, i) => {
      if (i === 0) {
        x.set(id, 0);
        cursor = 0;
        return;
      }
      const prev = order[i - 1]!;
      const arePartners = partnersList(id).includes(prev) && generation.get(prev) === g;
      cursor += arePartners ? PARTNER_STEP : CROSS_STEP;
      x.set(id, cursor);
    });
  }

  // Center each descendant generation UNDER its parents. Snapping every child to its parents' mean-x
  // would collapse a whole sibling set onto one point (the reported "children float far from the bus"
  // bug); instead GROUP children by their parent-couple, order the groups by that couple's x, lay each
  // group's members (partners adjacent, siblings a normal gap apart) as one block CENTERED on the couple
  // midpoint, then resolve overlaps left→right so neighbouring blocks never collide. Runs top-down (g
  // ascending) so each generation centers on its already-final parents.
  for (const g of drawnGens) {
    if (g <= 0) continue;
    const order = orderedByGen.get(g)!;
    const idSet = new Set(order);

    // Midpoint of a person's drawn parents (couple midpoint or lone-parent x), or undefined.
    const parentMid = (id: string): number | undefined => {
      const dp = parentsList(id).filter((p) => isDrawn(p) && x.has(p));
      if (dp.length === 0) return undefined;
      return dp.reduce((a, p) => a + x.get(p)!, 0) / dp.length;
    };
    // Stable key for a person's drawn parents, so FULL siblings land in the same group.
    const parentKey = (id: string): string | null => {
      const dp = parentsList(id).filter((pp) => isDrawn(pp)).sort();
      return dp.length === 0 ? null : dp.join("&");
    };

    // Walk the row into UNITS — a child kept adjacent to its drawn same-generation partner (an in-law).
    const consumed = new Set<string>();
    interface Unit {
      members: string[];
      anchor: number;
      key: string;
      seq: number;
    }
    const units: Unit[] = [];
    let seq = 0;
    for (const id of order) {
      if (consumed.has(id)) continue;
      const partner = partnerOf(id);
      const members =
        partner && idSet.has(partner) && !consumed.has(partner) ? orderPartners(id, partner) : [id];
      for (const m of members) consumed.add(m);
      // Anchor + group key come from whichever member has drawn parents (the lineage child; the other is
      // an in-law). Fall back to the member's current x / a solo key when neither has drawn parents.
      let anchor: number | undefined;
      let key: string | null = null;
      for (const m of members) {
        const pm = parentMid(m);
        if (pm !== undefined) {
          anchor = pm;
          key = parentKey(m);
          break;
        }
      }
      units.push({
        members,
        anchor: anchor ?? x.get(members[0]!)!,
        key: key ?? `solo:${members[0]}`,
        seq: seq++,
      });
    }

    // Group units by parent (full siblings share a group), then order groups left→right by anchor.
    const groupsMap = new Map<string, Unit[]>();
    for (const u of units) {
      const arr = groupsMap.get(u.key);
      if (arr) arr.push(u);
      else groupsMap.set(u.key, [u]);
    }
    const groups = [...groupsMap.values()].sort((a, b) =>
      a[0]!.anchor !== b[0]!.anchor ? a[0]!.anchor - b[0]!.anchor : a[0]!.seq - b[0]!.seq,
    );

    // Lay each group as a contiguous block centered on its anchor; shift right to clear the previous one.
    let prevRight = -Infinity; // right edge (center + NODE_W/2) of the last placed member
    const newX = new Map<string, number>();
    for (const grp of groups) {
      const flat: string[] = [];
      for (const u of grp) for (const m of u.members) flat.push(m);
      const stepBefore = (i: number): number =>
        partnersList(flat[i]!).includes(flat[i - 1]!) ? PARTNER_STEP : CROSS_STEP;
      let span = 0;
      for (let i = 1; i < flat.length; i++) span += stepBefore(i);
      let firstCenter = grp[0]!.anchor - span / 2;
      const minFirst = prevRight + NODE_W / 2 + CROSS_H_GAP; // keep a full sibling gap between blocks
      if (firstCenter < minFirst) firstCenter = minFirst;
      let c = firstCenter;
      for (let i = 0; i < flat.length; i++) {
        if (i > 0) c += stepBefore(i);
        newX.set(flat[i]!, c);
      }
      prevRight = c + NODE_W / 2;
    }
    for (const [id, cx] of newX) x.set(id, cx);
  }

  // --- Normalize both axes so the tightest box starts at 0 ---------------
  const rawY = new Map<string, number>();
  for (const id of drawable) rawY.set(id, yForGen(generation.get(id)!));

  const drawnIds = [...drawable];
  let minX = Infinity;
  let minY = Infinity;
  for (const id of drawnIds) {
    minX = Math.min(minX, x.get(id)!);
    minY = Math.min(minY, rawY.get(id)!);
  }
  if (!isFinite(minX)) minX = 0;
  if (!isFinite(minY)) minY = 0;
  const offsetX = -minX + NODE_W / 2 + SIDE_PAD;
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
    const key = coupleKey(e.personAId, e.personBId);
    if (unionSeen.has(key)) continue;
    unionSeen.add(key);
    unions.push({
      aPersonId: e.personAId,
      bPersonId: e.personBId,
      x: (a.x + b.x) / 2,
      y: a.y,
    });
  }

  // Record drawn couples (and single drawn parents that have drawn children) for the descent bus.
  {
    const seen = new Set<string>();
    for (const p of placed) {
      const partner = partnerOf(p.personId);
      const partnerDrawn = partner != null && isDrawn(partner);
      const ck = coupleKey(p.personId, partnerDrawn ? partner : null);
      if (seen.has(ck)) continue;
      seen.add(ck);
      if (partnerDrawn) {
        const pa = posOf.get(p.personId)!;
        const pb = posOf.get(partner!)!;
        const [leftId, rightId] = pa.x <= pb.x ? [p.personId, partner!] : [partner!, p.personId];
        couplesByCenter.push({ leftId, rightId, ck });
      } else {
        couplesByCenter.push({ leftId: p.personId, rightId: null, ck });
      }
    }
  }

  // --- Descent bus connectors (spec §6) ----------------------------------
  // The parent→children descent bus for a drawn couple/parent with ≥1 DRAWN child is drawn in three
  // parts, each conditional (per the shape rules):
  //   1. "U" — TWO parents only: both parents' bottom-centers drop to a join level and cross; a lone
  //      parent gets NO U (just its own bottom-center). This U is part of the descent bus, NOT a
  //      row-level line between the spouse cards (that partner LINK is intentionally never drawn).
  //   2. vertical riser — from the join/midpoint (or lone parent's bottom) down to the child-bar level.
  //   3. "inverted-U" — 2+ children only: a horizontal bar with a vertical down to EACH child; a single
  //      child gets NO inverted-U (the riser drops straight into it).
  const connectors: Connector[] = [];
  for (const couple of couplesByCenter) {
    const partner = couple.rightId;
    const kids = coupleChildren(couple.leftId, partner).filter((c) => isDrawn(c));
    if (kids.length === 0) continue;
    const left = posOf.get(couple.leftId)!;
    const right = partner ? posOf.get(partner)! : null;

    const parentBottomY = left.y + NODE_H / 2;
    const busCenterX = right ? (left.x + right.x) / 2 : left.x;
    // Join level: a short drop below the parents where the two feeders meet (the U's floor).
    const joinY = parentBottomY + JOIN_DROP;

    const sortedKids = kids
      .map((c) => posOf.get(c)!)
      .sort((a, b) => a.x - b.x);
    const childTopY = sortedKids[0]!.y - NODE_H / 2;
    const barY = (joinY + childTopY) / 2;

    // 1. The U — two parents only.
    if (right) {
      connectors.push({
        kind: "descent",
        d: `M ${left.x} ${parentBottomY} L ${left.x} ${joinY} L ${right.x} ${joinY} L ${right.x} ${right.y + NODE_H / 2}`,
      });
    }

    // 2. Vertical riser from the join (couple) or the lone parent's bottom down to the bar level.
    const riserTop = right ? joinY : parentBottomY;
    connectors.push({ kind: "descent", d: `M ${busCenterX} ${riserTop} L ${busCenterX} ${barY}` });

    // 3. Into the children.
    if (sortedKids.length === 1) {
      // One child → NO inverted-U: drop straight into it (a short horizontal jog only if it's off-center).
      const c = sortedKids[0]!;
      connectors.push({ kind: "descent", d: `M ${busCenterX} ${barY} L ${c.x} ${barY} L ${c.x} ${childTopY}` });
    } else {
      // 2+ children → an inverted-U whose TOP CORNERS are emitted inside one polyline so they can be
      // ROUNDED at render time; children not on a rounded leg drop from the bar as separate verticals
      // (plain T-junctions on the FLAT part of the bar). The riser must attach where the bar is flat or
      // at a bar ENDPOINT — never at a rounded corner, or a visible seam opens after rounding. So when
      // collision-avoidance pushed the block off the couple midpoint (busCenterX outside the children's
      // span), busCenterX becomes the bar's flat endpoint and the now-interior outer child drops on its
      // own.
      const x0 = sortedKids[0]!.x; // leftmost child
      const x1 = sortedKids[sortedKids.length - 1]!.x; // rightmost child
      const drop = (cx: number) => ({ kind: "descent" as const, d: `M ${cx} ${barY} L ${cx} ${childTopY}` });
      if (busCenterX < x0) {
        // Riser enters at the LEFT end (flat); only the right corner rounds down into the rightmost child.
        connectors.push({ kind: "descent", d: `M ${busCenterX} ${barY} L ${x1} ${barY} L ${x1} ${childTopY}` });
        for (let i = 0; i < sortedKids.length - 1; i++) connectors.push(drop(sortedKids[i]!.x));
      } else if (busCenterX > x1) {
        connectors.push({ kind: "descent", d: `M ${x0} ${childTopY} L ${x0} ${barY} L ${busCenterX} ${barY}` });
        for (let i = 1; i < sortedKids.length; i++) connectors.push(drop(sortedKids[i]!.x));
      } else {
        // Normal: an inverted-U over the outer children (both top corners round); the riser meets the
        // flat middle of the bar, and middle children drop from the flat bar.
        connectors.push({
          kind: "descent",
          d: `M ${x0} ${childTopY} L ${x0} ${barY} L ${x1} ${barY} L ${x1} ${childTopY}`,
        });
        for (let i = 1; i < sortedKids.length - 1; i++) connectors.push(drop(sortedKids[i]!.x));
      }
    }
  }
  // NO partner-link connector: two cards sharing a row are never joined by a direct horizontal line at
  // their own row height. A partnership reads from PROXIMITY (partners sit ~half the normal gap apart,
  // PARTNER_GAP); the couple's connection is the descent bus below them (the U + riser).

  // --- Affordances (caret / "+") per spec §3 -----------------------------
  // Compute the children-caret dedup: a couple owns a children-caret only if it has children and NONE
  // are currently drawn. Once a child is drawn, other children come off THAT child's sibling-caret.
  const affordances: Affordance[] = [];

  // Index which couples have a drawn child (so we suppress their children-caret; those children are
  // reached via the drawn child's sibling-caret).
  const coupleHasDrawnChild = new Map<string, boolean>();
  for (const p of placed) {
    const partner = partnerOf(p.personId);
    const partnerDrawn = partner != null && isDrawn(partner);
    const ck = coupleKey(p.personId, partnerDrawn ? partner : null);
    if (coupleHasDrawnChild.has(ck)) continue;
    const kids = coupleChildren(p.personId, partnerDrawn ? partner : null);
    coupleHasDrawnChild.set(ck, kids.some((c) => isDrawn(c)));
  }

  for (const p of placed) {
    const id = p.personId;
    const n = p.node;
    // Anonymous bridge nodes (identified === false) are INERT: no carets, no "+" (spec §2/ADR-0017).
    if (!n.identified) continue;

    const partner = partnerOf(id);
    // Nearer-owns (ADR-0018): a person emits its own parents ↑ / siblings ↔ affordances ONLY when it
    // was reached "as an individual" — the anchor, a drawn partner (in-laws, no carve-out), or a
    // lineage parent reached via its child's parent-caret. A `child-set` member (revealed child,
    // cousin, niece) shows no parent-caret back up toward the anchor; a `sibling-set` member (fanned
    // sibling) shows no sibling affordance at all — those edges are owned by the nearer discoverer.
    const via = discoveredVia.get(id);
    const ownsIndividual = via === "anchor" || via === "partner" || via === "parent-caret";

    // --- Parents ↑ (per-person) — only the owner of its parent-reveal emits ---
    if (ownsIndividual) {
      const loaded = parentsList(id);
      const drawnParents = loaded.filter((pp) => isDrawn(pp));
      const hasKin = loaded.length > 0 || n.hasHiddenParents;
      if (hasKin) {
        affordances.push({
          direction: "parents",
          kind: "caret",
          expanded: drawnParents.length > 0,
          ownerId: id,
          side: "center",
          x: p.x,
          y: p.y - NODE_H / 2 - CARET_GAP,
        });
      } else {
        affordances.push({
          direction: "parents",
          kind: "add",
          expanded: false,
          ownerId: id,
          side: "center",
          x: p.x,
          y: p.y - NODE_H / 2 - CARET_GAP,
        });
      }
    }

    // --- Siblings ↔ (per-person, ego-side outer border) — only the set-owner emits ---
    if (ownsIndividual) {
      const sibs = siblingsOf(id);
      const drawnSibs = sibs.filter((s) => isDrawn(s));
      // Side via the SHARED rule — identical to the sibling-fan's pin side (spec §3/§4).
      const side = siblingSide(id);
      const gutterX =
        side === "left" ? p.x - NODE_W / 2 - CARET_GAP : p.x + NODE_W / 2 + CARET_GAP;
      const hasKin = sibs.length > 0;
      affordances.push({
        direction: "siblings",
        kind: hasKin ? "caret" : "add",
        expanded: drawnSibs.length > 0,
        ownerId: id,
        side,
        x: gutterX,
        y: p.y,
      });
    }

    // --- Children ↓ (per-couple, dedup) ---
    // Draw the children affordance ONCE per couple, anchored on the LEFT partner (or the single
    // parent). Skip if the right partner (we only anchor on the left of a drawn pair).
    //
    // Nearer-owns (ADR-0018): a couple reached FROM BELOW — discovered because one of its own children
    // expanded its parents ↑ caret — does NOT own the vertical edge to that child. The child (nearer
    // the anchor) owns it via its parents ↑ caret, and that child's siblings come off the child's
    // sibling-caret. So a direct-lineage parent couple draws NO children affordance at all (else the
    // bus carries two carets: the parent's ↓ and the child's ↑). Either member reached via
    // `parent-caret` marks the whole couple as reached-from-below.
    const coupleFromBelow =
      via === "parent-caret" ||
      (partner != null && discoveredVia.get(partner) === "parent-caret");
    if (!coupleFromBelow) {
      const partnerDrawn = partner != null && isDrawn(partner);
      const isLeftAnchor = (() => {
        if (!partnerDrawn) return true;
        const pa = posOf.get(id)!;
        const pb = posOf.get(partner!)!;
        return pa.x <= pb.x;
      })();
      if (isLeftAnchor) {
        const ck = coupleKey(id, partnerDrawn ? partner : null);
        const kids = coupleChildren(id, partnerDrawn ? partner : null);
        const drawnKids = kids.filter((c) => isDrawn(c));
        const busCenterX = partnerDrawn ? (p.x + posOf.get(partner!)!.x) / 2 : p.x;
        // The children affordance HUGS the couple's bottom seam — the same fixed offset (CARET_GAP) the
        // parent-caret and the single-parent children-caret already use. Its position is IDENTICAL
        // whether collapsed or expanded and whether caret or "+": when expanded the descent U passes
        // BELOW and behind the glyph (the U floor is at joinY = bottom + JOIN_DROP, deeper than this).
        // Fixing the offset per-couple is what lets a click seed BOTH parents (the couple owns coupleId),
        // and extends cleanly to multiple partners (each partnership's seam is its own affordance).
        // (Was `partnerDrawn ? JOIN_DROP : CARET_GAP` — the couple case dropped to the U-floor, which
        // floated in empty space when collapsed since no U is drawn then. 2026-07-14 regression fix.)
        const childrenCaretY = p.y + NODE_H / 2 + CARET_GAP;
        // Dedup rule (spec §3): children-caret only if it has children AND none are drawn.
        if (kids.length > 0 && drawnKids.length === 0) {
          affordances.push({
            direction: "children",
            kind: "caret",
            expanded: false,
            ownerId: id,
            coupleId: ck,
            side: "center",
            x: busCenterX,
            y: childrenCaretY,
          });
        } else if (drawnKids.length > 0) {
          // Children are drawn → a COLLAPSE caret (so the user can prune the descent branch).
          affordances.push({
            direction: "children",
            kind: "caret",
            expanded: true,
            ownerId: id,
            coupleId: ck,
            side: "center",
            x: busCenterX,
            y: childrenCaretY,
          });
        } else {
          // No children anywhere → "+" to add one.
          affordances.push({
            direction: "children",
            kind: "add",
            expanded: false,
            ownerId: id,
            coupleId: ck,
            side: "center",
            x: busCenterX,
            y: childrenCaretY,
          });
        }
      }
    }
  }

  affordances.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction < b.direction ? -1 : 1;
    if (a.ownerId !== b.ownerId) return a.ownerId < b.ownerId ? -1 : 1;
    return 0;
  });

  // --- Bounds ------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Expansion reducer — the client toggles a caret through this so Rule-8 coupling is applied uniformly.
// ---------------------------------------------------------------------------

function withAdded(s: ReadonlySet<string>, v: string): Set<string> {
  const n = new Set(s);
  n.add(v);
  return n;
}
function withRemoved(s: ReadonlySet<string>, v: string): Set<string> {
  const n = new Set(s);
  n.delete(v);
  return n;
}

/** The minimal shape of a caret the reducer needs (a subset of {@link Affordance}). */
export interface AffordanceToggle {
  direction: AffordanceDirection;
  /** The person (parents/siblings) or left-anchor (children) the caret belongs to. */
  ownerId: string;
  /** For `children`: the {@link coupleKey}; defaults to `coupleKey(ownerId)`. */
  coupleId?: string;
  /** Whether the caret is CURRENTLY expanded (so activating it collapses). */
  expanded: boolean;
}

/**
 * Apply a caret toggle to the expansion state, enforcing the Rule-8 sibling⇄parent coupling
 * (CONTEXT.md § "Rule 8 coupling"): expanding a person's siblings AUTO-EXPANDS that person's parents
 * (siblings hang off the shared parent-couple's descent bus); collapsing the parents also collapses the
 * siblings (the bus is gone). Collapsing siblings leaves the parents standing. Pure — returns a new state.
 */
export function toggleAffordanceExpansion(
  e: ExpansionState,
  a: AffordanceToggle,
): ExpansionState {
  if (a.direction === "parents") {
    if (a.expanded) {
      // Collapse parents → also collapse this person's siblings (their bus is gone).
      return {
        ...e,
        collapsedParents: withAdded(e.collapsedParents, a.ownerId),
        expandedParents: withRemoved(e.expandedParents, a.ownerId),
        collapsedSiblings: withAdded(e.collapsedSiblings, a.ownerId),
        expandedSiblings: withRemoved(e.expandedSiblings, a.ownerId),
      };
    }
    return {
      ...e,
      expandedParents: withAdded(e.expandedParents, a.ownerId),
      collapsedParents: withRemoved(e.collapsedParents, a.ownerId),
    };
  }
  if (a.direction === "siblings") {
    if (a.expanded) {
      // Collapse siblings → parents stand alone.
      return {
        ...e,
        collapsedSiblings: withAdded(e.collapsedSiblings, a.ownerId),
        expandedSiblings: withRemoved(e.expandedSiblings, a.ownerId),
      };
    }
    // Expand siblings → auto-expand parents (Rule 8).
    return {
      ...e,
      expandedSiblings: withAdded(e.expandedSiblings, a.ownerId),
      collapsedSiblings: withRemoved(e.collapsedSiblings, a.ownerId),
      expandedParents: withAdded(e.expandedParents, a.ownerId),
      collapsedParents: withRemoved(e.collapsedParents, a.ownerId),
    };
  }
  // children (per couple)
  const ck = a.coupleId ?? coupleKey(a.ownerId);
  if (a.expanded) {
    return {
      ...e,
      collapsedChildren: withAdded(e.collapsedChildren, ck),
      expandedChildren: withRemoved(e.expandedChildren, ck),
    };
  }
  return {
    ...e,
    expandedChildren: withAdded(e.expandedChildren, ck),
    collapsedChildren: withRemoved(e.collapsedChildren, ck),
  };
}

/**
 * Round the corners of a connector path for display. Takes an M/L polyline (what the descent bus emits)
 * and replaces each interior vertex with a short quadratic curve of radius ≤ `r` (clamped to half the
 * shorter adjacent segment so it never overshoots). Straight 2-point segments pass through unchanged.
 * Pure and render-only — the layout keeps emitting exact logical geometry; the canvas rounds for paint.
 */
export function roundedPath(d: string, r: number): string {
  const nums = (d.match(/-?[\d.]+/g) ?? []).map(Number);
  const raw: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) raw.push([nums[i]!, nums[i + 1]!]);
  // Drop zero-length segments (duplicate consecutive points).
  const p: Array<[number, number]> = [];
  for (const q of raw) {
    const last = p[p.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-6) p.push(q);
  }
  if (p.length < 2) return d;
  const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();
  if (p.length === 2) return `M ${fmt(p[0]![0])} ${fmt(p[0]![1])} L ${fmt(p[1]![0])} ${fmt(p[1]![1])}`;
  let out = `M ${fmt(p[0]![0])} ${fmt(p[0]![1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [px, py] = p[i - 1]!;
    const [cx, cy] = p[i]!;
    const [nx, ny] = p[i + 1]!;
    const d1 = Math.hypot(cx - px, cy - py);
    const d2 = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    if (rr < 1e-3) {
      out += ` L ${fmt(cx)} ${fmt(cy)}`;
      continue;
    }
    const bx = cx - ((cx - px) / d1) * rr;
    const by = cy - ((cy - py) / d1) * rr;
    const ax = cx + ((nx - cx) / d2) * rr;
    const ay = cy + ((ny - cy) / d2) * rr;
    out += ` L ${fmt(bx)} ${fmt(by)} Q ${fmt(cx)} ${fmt(cy)} ${fmt(ax)} ${fmt(ay)}`;
  }
  const last = p[p.length - 1]!;
  out += ` L ${fmt(last[0])} ${fmt(last[1])}`;
  return out;
}

/** Convenience: build layout straight from a {@link KinshipTreeData} read + expansion state. */
export function layoutFromTreeData(
  data: KinshipTreeData,
  focusPersonId: string = data.rootPersonId,
  expansion: ExpansionState = EMPTY_EXPANSION,
): TreeLayout {
  return computeTreeLayout({
    nodes: data.nodes,
    edges: data.edges,
    focusPersonId,
    expansion,
  });
}
