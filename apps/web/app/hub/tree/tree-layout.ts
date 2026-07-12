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
  /** Whole generations (relative to root: -2, -1, 0, +1, …) the user has collapsed. */
  collapsedGenerations: ReadonlySet<number>;
}

export const EMPTY_EXPANSION: ExpansionState = {
  expandedParents: new Set(),
  expandedChildren: new Set(),
  collapsedGenerations: new Set(),
};

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

/** An interactive affordance the canvas renders as a medium-weight chevron caret. */
export interface Affordance {
  kind: "expand-parents" | "expand-children" | "collapse-generation";
  /** personId for expand affordances; generation index for collapse-generation. */
  targetId: string;
  x: number;
  y: number;
  /**
   * For expand affordances: true when the kin to reveal are NOT yet loaded (boundary node), so the
   * client must fetch before revealing. False ⇒ a purely client-side reveal.
   */
  requiresFetch?: boolean;
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

/**
 * Compute node positions, connector geometry, and expand/collapse affordances for the current
 * node/edge set rooted at `rootPersonId`. Deterministic (stable ordering) so identical data always
 * lays out identically.
 *
 * SHARED CONTRACT STUB — Track-B "B-layout" implements this against the spec.
 */
export function computeTreeLayout(_input: LayoutInput): TreeLayout {
  throw new Error("NOT_IMPLEMENTED: computeTreeLayout (Stage-0 contract stub)");
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
