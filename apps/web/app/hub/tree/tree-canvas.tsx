"use client";
/**
 * TreeCanvas — the interactive visual family tree (spec §7).
 *
 * Owns the loaded `nodes`/`edges`, the `expansion` state (starts EMPTY_EXPANSION), and a `pan` offset.
 * Renders an SVG connector layer with absolutely-positioned HTML node cards over it (so node cards are
 * real, tappable, accessible buttons while connectors stay crisp SVG). Supports drag-to-pan and a
 * **Fit** button that reframes on the root. No zoom (v1).
 *
 * Fetch-on-expand: an expand caret with `requiresFetch` calls the server action for that subtree and
 * merges the result (dedup by personId / edge key), then re-runs the pure layout. In-window carets and
 * generation collapse are pure client reveals (mutate `expansion`). The layout function is pure and
 * re-runs on every render from (nodes, edges, root, expansion).
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
import { fetchSubtreeAction, type FetchSubtreeResult } from "./actions";

export interface TreeCanvasProps {
  familyId: string;
  rootPersonId: string;
  initial: KinshipTreeData;
  /** Injected server action (spec §7). Defaults to the real fetchSubtreeAction; overridable in tests. */
  fetchSubtree?: (familyId: string, centerPersonId: string) => Promise<FetchSubtreeResult>;
}

/** Toggle a value in an immutable set copy. */
function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function TreeCanvas({
  familyId,
  rootPersonId,
  initial,
  fetchSubtree = fetchSubtreeAction,
}: TreeCanvasProps) {
  const [nodes, setNodes] = useState<TreeNode[]>(initial.nodes);
  const [edges, setEdges] = useState<ResolvedKinshipEdge[]>(initial.edges);
  const [expansion, setExpansion] = useState<ExpansionState>(EMPTY_EXPANSION);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const draggingRef = useRef(false);

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
    // Center root horizontally, a comfortable margin from the top.
    setPan({ x: -root.x, y: -root.y + NODE_H });
  }, [layout, rootPersonId]);

  // Center on the root at first paint so the tree doesn't open off in a corner (spec §7 Fit). Only on
  // mount / when the root identity changes — never on every expansion, which would yank the viewport
  // back to the root and undo the user's panning as they explore.
  useEffect(() => {
    fitToRoot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPersonId]);

  const doExpand = useCallback(
    async (aff: Affordance) => {
      if (aff.kind === "collapse-generation") {
        const gen = Number(aff.targetId);
        setExpansion((e) => ({ ...e, collapsedGenerations: toggle(e.collapsedGenerations, gen) }));
        return;
      }
      const isParents = aff.kind === "expand-parents";
      if (!aff.requiresFetch) {
        // Pure client-side reveal — the kin are already loaded.
        setExpansion((e) =>
          isParents
            ? { ...e, expandedParents: toggle(e.expandedParents, aff.targetId) }
            : { ...e, expandedChildren: toggle(e.expandedChildren, aff.targetId) },
        );
        return;
      }
      // Boundary caret ⇒ fetch that subtree, merge, then reveal (client-side reveal on the merged set).
      setPending(true);
      setLoadError(null);
      try {
        const res = await fetchSubtree(familyId, aff.targetId);
        if (!res.ok) {
          setLoadError(hub.tree.loadFailed);
          return;
        }
        setNodes((prev) => mergeNodes(prev, res.data.nodes));
        setEdges((prev) => mergeEdges(prev, res.data.edges));
        setExpansion((e) =>
          isParents
            ? { ...e, expandedParents: toggle(e.expandedParents, aff.targetId) }
            : { ...e, expandedChildren: toggle(e.expandedChildren, aff.targetId) },
        );
      } catch {
        setLoadError(hub.tree.loadFailed);
      } finally {
        setPending(false);
      }
    },
    [familyId, fetchSubtree],
  );

  // --- Drag-to-pan (pointer events) --------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    draggingRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) draggingRef.current = true;
    setPan({ x: d.panX + dx, y: d.panY + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // Suppress a node tap that was actually the end of a drag.
  const onNodeTap = (personId: string) => {
    if (draggingRef.current) return;
    setSelected(personId);
  };

  const selectedNode = selected ? nodeById.get(selected) ?? null : null;

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
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "0.75rem",
            color: "var(--text-meta)",
          }}
        >
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
              style={{
                position: "absolute",
                left: p.x - NODE_W / 2,
                top: p.y - NODE_H / 2,
              }}
            >
              <PersonNode node={p.node} isRoot={p.personId === rootPersonId} onTap={onNodeTap} />
            </div>
          ))}

          {/* Caret / collapse affordances (medium-weight chevrons). */}
          {layout.affordances.map((aff) => (
            <CaretButton key={`${aff.kind}:${aff.targetId}`} aff={aff} onActivate={doExpand} />
          ))}
        </div>
      </div>

      {selectedNode && (
        <PersonPanel
          node={selectedNode}
          isRoot={selectedNode.personId === rootPersonId}
          familyId={familyId}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** A single medium-weight chevron caret (expand up/down) or a generation-collapse control. */
function CaretButton({
  aff,
  onActivate,
}: {
  aff: Affordance;
  onActivate: (aff: Affordance) => void;
}) {
  const label =
    aff.kind === "expand-parents"
      ? hub.tree.expandParents
      : aff.kind === "expand-children"
        ? hub.tree.expandChildren
        : hub.tree.collapseGeneration;

  // Medium-weight chevron glyph: up for parents, down for children, a small bar for collapse.
  const glyph = aff.kind === "expand-parents" ? "⌃" : aff.kind === "expand-children" ? "⌄" : "−";

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
