"use client";
/**
 * TreeCanvas — the interactive visual family tree (spec §7).
 *
 * Owns the loaded `nodes`/`edges`, the `expansion` state (starts EMPTY_EXPANSION), the client-side
 * `rootPersonId` (re-rooting is a smooth client re-fetch, not a page navigation), and a `pan` offset.
 * Renders an SVG connector layer with absolutely-positioned HTML node cards over it (so node cards are
 * real, tappable, accessible buttons while connectors stay crisp SVG). Supports drag-to-pan and a
 * **Fit** button that reframes on the root. No zoom (v1).
 *
 * Interaction model (spec §7):
 *   - FIRST tap on a node SELECTS it (opens the read-only panel). Cheap, no fetch.
 *   - SECOND tap on the SAME selected node RE-ROOTS the tree on that person: fetch their neighborhood,
 *     merge it in, relabel relations to the new root, reset expansion, and smoothly pan onto them.
 *   - A pointer that MOVES beyond a small threshold between down and up is a drag, not a tap.
 *
 * Fetch-on-expand: an ancestor/descendant caret with `requiresFetch` calls the server action for that
 * subtree and merges the result (dedup by personId / edge key), then re-runs the pure layout. In-window
 * carets are pure client reveals/collapses (mutate `expansion`). The layout function is pure and re-runs
 * on every render from (nodes, edges, root, expansion).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hub } from "@/app/_copy";
import type { KinshipTreeData, ResolvedKinshipEdge, TreeNode } from "@chronicle/core";
import {
  computeTreeLayout,
  EMPTY_EXPANSION,
  type Affordance,
  type ExpansionState,
} from "./tree-layout";
import { NODE_H, NODE_W, PersonNode } from "./person-node";
import { PersonPanel } from "./person-panel";
import { mergeEdges, mergeNodes } from "./merge";
import { relabelToRoot } from "./relabel";
import { fetchSubtreeAction, type FetchSubtreeResult } from "./actions";

export interface TreeCanvasProps {
  familyId: string;
  /** The INITIAL focal root. Re-rooting is client state seeded from this. */
  rootPersonId: string;
  /** The viewer's own personId — the single node labeled "You", regardless of the focal root. */
  viewerPersonId: string;
  initial: KinshipTreeData;
  /** Injected server action (spec §7). Defaults to the real fetchSubtreeAction; overridable in tests. */
  fetchSubtree?: (familyId: string, centerPersonId: string) => Promise<FetchSubtreeResult>;
}

/** Return an immutable set copy with `value` toggled in/out. */
function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Return an immutable set copy with `value` added. */
function add<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  next.add(value);
  return next;
}

/** How far (px) a pointer may move between down and up and still count as a tap, not a drag. */
const TAP_SLOP = 6;
/** Smooth re-root pan transition duration (ms). */
const RECENTER_MS = 300;

export function TreeCanvas({
  familyId,
  rootPersonId: initialRootPersonId,
  viewerPersonId,
  initial,
  fetchSubtree = fetchSubtreeAction,
}: TreeCanvasProps) {
  const [rootPersonId, setRootPersonId] = useState(initialRootPersonId);
  const [nodes, setNodes] = useState<TreeNode[]>(initial.nodes);
  const [edges, setEdges] = useState<ResolvedKinshipEdge[]>(initial.edges);
  const [expansion, setExpansion] = useState<ExpansionState>(EMPTY_EXPANSION);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [animating, setAnimating] = useState(false);

  // Drag-to-pan bookkeeping (the viewport background).
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  // Tap bookkeeping (a node card): remember which node + where the pointer went down.
  const tapRef = useRef<{ id: string; x: number; y: number } | null>(null);

  const layout = useMemo(
    () => computeTreeLayout({ nodes, edges, rootPersonId, expansion }),
    [nodes, edges, rootPersonId, expansion],
  );

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.personId, n])), [nodes]);

  /** Reframe so the root sits near the top-center of the viewport. */
  const fitToRoot = useCallback(() => {
    const root = layout.placed.find((p) => p.personId === rootPersonId) ?? layout.placed[0];
    if (!root) {
      setPan({ x: 0, y: 0 });
      return;
    }
    setPan({ x: -root.x, y: -root.y + NODE_H });
  }, [layout, rootPersonId]);

  // Center on the root at first paint AND on every client re-root (spec §7 Fit). Only when the root
  // identity changes — never on every expansion, which would yank the viewport back and undo panning.
  useEffect(() => {
    fitToRoot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPersonId]);

  // --- Smooth client-side re-root ----------------------------------------
  const recenterOn = useCallback(
    async (id: string) => {
      setPending(true);
      setLoadError(null);
      try {
        const res = await fetchSubtree(familyId, id);
        if (!res.ok) {
          setLoadError(hub.tree.loadFailed);
          return; // keep the prior root/data untouched
        }
        const mergedEdges = mergeEdges(edges, res.data.edges);
        const mergedNodes = relabelToRoot(mergeNodes(nodes, res.data.nodes), mergedEdges, id);
        setEdges(mergedEdges);
        setNodes(mergedNodes);
        setExpansion(EMPTY_EXPANSION);
        setRootPersonId(id);
        setSelected(id);
        // Shallow URL sync so a reload / share reflects the current root, without a navigation.
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("root", id);
          window.history.replaceState(window.history.state, "", url.toString());
        }
        // Brief pan transition as the viewport settles on the new root.
        setAnimating(true);
        window.setTimeout(() => setAnimating(false), RECENTER_MS);
      } catch {
        setLoadError(hub.tree.loadFailed);
      } finally {
        setPending(false);
      }
    },
    [familyId, fetchSubtree, edges, nodes],
  );

  // --- Boundary reveal fetch (caret with requiresFetch) -------------------
  const revealFetch = useCallback(
    async (kind: "parents" | "children", fetchPersonId: string) => {
      setPending(true);
      setLoadError(null);
      try {
        const res = await fetchSubtree(familyId, fetchPersonId);
        if (!res.ok) {
          setLoadError(hub.tree.loadFailed);
          return;
        }
        const mergedNodes = mergeNodes(nodes, res.data.nodes);
        const mergedEdges = mergeEdges(edges, res.data.edges);
        // Keep relations anchored to the CURRENT root (mergeNodes preserves known relations; relabel
        // fills any newly-linkable ones without re-rooting).
        setNodes(relabelToRoot(mergedNodes, mergedEdges, rootPersonId));
        setEdges(mergedEdges);
        setExpansion((e) =>
          kind === "parents"
            ? { ...e, expandedParents: add(e.expandedParents, fetchPersonId) }
            : { ...e, expandedChildren: add(e.expandedChildren, fetchPersonId) },
        );
      } catch {
        setLoadError(hub.tree.loadFailed);
      } finally {
        setPending(false);
      }
    },
    [familyId, fetchSubtree, nodes, edges, rootPersonId],
  );

  // --- Caret activation (pure reveal/collapse, or a boundary fetch) -------
  const onCaret = useCallback(
    (a: Affordance) => {
      if (a.kind === "ancestors") {
        if (a.expanded) {
          setExpansion((e) => ({ ...e, collapsedAncestors: toggle(e.collapsedAncestors, a.targetId) }));
        } else if (a.requiresFetch) {
          void revealFetch("parents", a.fetchPersonId);
        } else {
          setExpansion((e) => ({
            ...e,
            collapsedAncestors: toggle(e.collapsedAncestors, a.targetId),
            expandedParents: add(e.expandedParents, a.fetchPersonId),
          }));
        }
      } else {
        if (a.expanded) {
          setExpansion((e) => ({ ...e, collapsedDescendants: toggle(e.collapsedDescendants, a.targetId) }));
        } else if (a.requiresFetch) {
          void revealFetch("children", a.fetchPersonId);
        } else {
          setExpansion((e) => ({
            ...e,
            collapsedDescendants: toggle(e.collapsedDescendants, a.targetId),
            expandedChildren: add(e.expandedChildren, a.fetchPersonId),
          }));
        }
      }
    },
    [revealFetch],
  );

  // --- Drag-to-pan (viewport background) ---------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // --- Reliable node tap (first = select, second-on-same = re-root) ------
  const onNodePointerDown = (id: string, e: React.PointerEvent) => {
    e.stopPropagation(); // don't let the viewport treat this as a pan-start
    tapRef.current = { id, x: e.clientX, y: e.clientY };
  };
  const onNodePointerUp = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const t = tapRef.current;
    tapRef.current = null;
    if (!t || t.id !== id) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_SLOP) return; // a drag, not a tap
    if (selected === id) void recenterOn(id); // second tap ⇒ re-root
    else setSelected(id); // first tap ⇒ select + panel
  };

  const selectedNode = selected ? (nodeById.get(selected) ?? null) : null;

  return (
    <div style={{ position: "relative" }}>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button
          type="button"
          onClick={fitToRoot}
          data-testid="tree-fit"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            fontWeight: 600,
            padding: "8px 16px",
            borderRadius: "var(--radius-pill)",
            border: "var(--border-width) solid var(--border-strong)",
            background: "transparent",
            color: "var(--text-body)",
            cursor: "pointer",
          }}
        >
          {hub.tree.fit}
        </button>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "0.75rem", color: "var(--text-meta)" }}>
          {hub.tree.pan}
        </span>
        {pending && (
          <span data-testid="tree-loading" style={{ fontSize: "0.75rem", color: "var(--text-meta)" }}>
            …
          </span>
        )}
      </div>

      {loadError && (
        <p
          role="alert"
          data-testid="tree-load-error"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--accent)",
            margin: "0 0 12px",
          }}
        >
          {loadError}
        </p>
      )}

      {/* Canvas viewport */}
      <div
        data-testid="tree-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "relative",
          width: "100%",
          height: "min(70vh, 640px)",
          overflow: "hidden",
          borderRadius: "var(--radius-lg)",
          border: "var(--border-width) solid var(--border)",
          background: "var(--surface-page)",
          touchAction: "none",
          cursor: "grab",
        }}
      >
        <div
          data-testid="tree-pan-layer"
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            transition: animating ? `transform ${RECENTER_MS}ms ease` : undefined,
            width: layout.bounds.width,
            height: layout.bounds.height,
          }}
        >
          {/* Connector layer (SVG, behind node cards). */}
          <svg
            width={layout.bounds.width}
            height={layout.bounds.height}
            viewBox={`0 0 ${layout.bounds.width} ${layout.bounds.height}`}
            style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible" }}
            aria-hidden="true"
          >
            {layout.connectors.map((c, i) => (
              <path
                key={i}
                d={c.d}
                fill="none"
                stroke={c.kind === "partner" ? "var(--accent)" : "var(--border-strong)"}
                strokeWidth={c.kind === "partner" ? 2 : 1.5}
              />
            ))}
          </svg>

          {/* Node cards. */}
          {layout.placed.map((p) => (
            <div
              key={p.personId}
              onPointerDown={(e) => onNodePointerDown(p.personId, e)}
              onPointerUp={(e) => onNodePointerUp(p.personId, e)}
              style={{ position: "absolute", left: p.x - NODE_W / 2, top: p.y - NODE_H / 2 }}
            >
              <PersonNode node={p.node} isRoot={p.personId === rootPersonId} viewerPersonId={viewerPersonId} />
            </div>
          ))}

          {/* Per-box carets (medium-weight chevrons). */}
          {layout.affordances.map((aff) => (
            <CaretButton key={`${aff.kind}:${aff.targetId}`} aff={aff} onActivate={onCaret} />
          ))}
        </div>
      </div>

      {selectedNode && (
        <PersonPanel
          node={selectedNode}
          isRoot={selectedNode.personId === rootPersonId}
          familyId={familyId}
          viewerPersonId={viewerPersonId}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** A single medium-weight chevron caret (expand/collapse ancestors or descendants). */
function CaretButton({
  aff,
  onActivate,
}: {
  aff: Affordance;
  onActivate: (aff: Affordance) => void;
}) {
  // Direction: ancestors point up to reveal, down (toward the node) to collapse; descendants invert.
  const pointsUp = aff.kind === "ancestors" ? !aff.expanded : aff.expanded;
  const glyph = pointsUp ? "⌃" : "⌄";

  const label =
    aff.kind === "ancestors"
      ? aff.expanded
        ? hub.tree.hideParents
        : hub.tree.showParents
      : aff.expanded
        ? hub.tree.hideChildren
        : hub.tree.showChildren;

  const size = 22;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={`tree-affordance-${aff.kind}-${aff.targetId}`}
      onClick={(e) => {
        e.stopPropagation();
        onActivate(aff);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: aff.x - size / 2,
        top: aff.y - size / 2,
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: "var(--border-width) solid var(--border-strong)",
        background: "var(--surface-card)",
        color: "var(--text-muted)",
        cursor: "pointer",
        fontSize: "0.8rem",
        fontWeight: 500,
        lineHeight: 1,
        padding: 0,
        zIndex: 1,
      }}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
