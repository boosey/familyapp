"use client";
/**
 * TreeCanvas — the interactive ego-centric visual family tree (spec 2026-07-13, §1–§8).
 *
 * Owns the loaded `nodes`/`edges`, the `expansion` state, and a `pan` offset. Renders an SVG connector
 * layer with absolutely-positioned HTML node cards over it (real, tappable, accessible buttons over
 * crisp SVG). Drag-to-pan; a **Fit** button reframes on the focus. No zoom, no re-rooting, no selection
 * state (spec §1).
 *
 * Interaction model:
 *   - A node NAME click opens the read-only <PersonPanel>. It never re-roots.
 *   - Per-direction CARETS (parents ↑, siblings ↔, children ↓) expand/collapse a branch — CLIENT ONLY,
 *     instant, off the fetch path (spec §7: every drawn card's immediate kin is already loaded).
 *   - A "+" where a direction has no kin starts add-in-that-direction (navigates to /hub/kin).
 *   - A per-card ⋮ (KebabMenu) adds relatives, gated by loaded adjacency. No global kebab.
 *   - A pointer that MOVES beyond a small threshold is a drag (pan), not a tap.
 *
 * Data loading (spec §7): the initial read is a bounded neighborhood; after each expansion a BACKGROUND
 * fetch tops the buffer up to one layer past the frontier so the next caret-vs-"+" is accurate and the
 * next expansion is instant. The background top-up is best-effort and off the critical path.
 *
 * The layout function (./tree-layout) is pure and re-runs on every render from (nodes, edges, focus,
 * expansion).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { hub } from "@/app/_copy";
import type { KinshipTreeData, ResolvedKinshipEdge, TreeNode } from "@chronicle/core";
// Client-safe kinship derivation (type-only server barrel avoided — no node:crypto in the bundle).
import { deriveKin, type KinRelation } from "@chronicle/core/kinship-derive";
import {
  coupleKey,
  computeTreeLayout,
  EMPTY_EXPANSION,
  type Affordance,
  type ExpansionState,
} from "./tree-layout";
import { NODE_H, NODE_W, PersonNode, isAnonymousBridge } from "./person-node";
import { PersonPanel } from "./person-panel";
import { KebabMenu } from "./kebab-menu";
import { mergeEdges, mergeNodes } from "./merge";
import { fetchSubtreeAction, type FetchSubtreeResult } from "./actions";

export interface TreeCanvasProps {
  familyId: string;
  /** The FIXED focus person (spec §1). Seeds framing + initial expansion; never re-rooted. */
  focusPersonId: string;
  /** The viewer's own personId — the tree data is rooted here, so relations read relative to them. */
  viewerPersonId: string;
  initial: KinshipTreeData;
  /** Injected server action (spec §7). Defaults to the real fetchSubtreeAction; overridable in tests. */
  fetchSubtree?: (familyId: string, centerPersonId: string) => Promise<FetchSubtreeResult>;
}

function add<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  next.add(value);
  return next;
}
function remove<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  next.delete(value);
  return next;
}

/** Loaded adjacency counts per person, for the kebab gates (parents ≤2, partner ≤1 in v1). */
interface AdjCounts {
  parents: number;
  partners: number;
}
function adjacencyCounts(edges: readonly ResolvedKinshipEdge[]): Map<string, AdjCounts> {
  const m = new Map<string, AdjCounts>();
  const get = (id: string): AdjCounts => {
    let c = m.get(id);
    if (!c) {
      c = { parents: 0, partners: 0 };
      m.set(id, c);
    }
    return c;
  };
  for (const e of edges) {
    if (e.edgeType === "parent_of") {
      get(e.personBId).parents += 1;
      get(e.personAId);
    } else {
      get(e.personAId).partners += 1;
      get(e.personBId).partners += 1;
    }
  }
  return m;
}

/** How far (px) a pointer may move between down and up and still count as a tap, not a drag. */
const DRAG_SLOP = 6;

export function TreeCanvas({
  familyId,
  focusPersonId,
  viewerPersonId,
  initial,
  fetchSubtree = fetchSubtreeAction,
}: TreeCanvasProps) {
  const router = useRouter();
  const [nodes, setNodes] = useState<TreeNode[]>(initial.nodes);
  const [edges, setEdges] = useState<ResolvedKinshipEdge[]>(initial.edges);
  const [expansion, setExpansion] = useState<ExpansionState>(EMPTY_EXPANSION);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selected, setSelected] = useState<string | null>(null);

  // Track which frontier centers we've already background-fetched, so top-up never re-fetches the same
  // node twice (idempotent, quiet, off the critical path).
  const toppedUp = useRef<Set<string>>(new Set());

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const tapRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const didDragRef = useRef(false);

  const layout = useMemo(
    () => computeTreeLayout({ nodes, edges, focusPersonId, expansion }),
    [nodes, edges, focusPersonId, expansion],
  );

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.personId, n])), [nodes]);

  // The focus's position in layout space. The layout re-normalizes its origin on every expansion (the
  // tightest box starts at 0), so a node's absolute (x,y) shifts by a whole generation-step when kin
  // appear above/below. We make the FOCUS the camera origin (below) so those shifts cancel out and an
  // expand/collapse never yanks the viewport. Falls back to (0,0) if the focus somehow isn't drawn.
  const focusPos = useMemo(() => {
    const f = layout.placed.find((p) => p.personId === focusPersonId);
    return f ? { x: f.x, y: f.y } : { x: 0, y: 0 };
  }, [layout, focusPersonId]);

  // Relation of each person to the VIEWER, derived from the loaded edges (the tree is focus-rooted, so
  // node.relationToRoot is relation-to-focus and can't be used for the panel). Empty when the viewer
  // isn't reachable in the loaded projection (distant focus) — the panel then omits the relation line.
  const viewerRelation = useMemo(() => {
    const m = new Map<string, KinRelation | "self">();
    m.set(viewerPersonId, "self");
    for (const k of deriveKin([...edges], viewerPersonId)) m.set(k.personId, k.relation);
    return m;
  }, [edges, viewerPersonId]);

  const adj = useMemo(() => adjacencyCounts(edges), [edges]);
  const countsFor = useCallback(
    (id: string): AdjCounts => adj.get(id) ?? { parents: 0, partners: 0 },
    [adj],
  );

  /**
   * Reframe on the focus. `pan` is the focus's on-screen offset from the pan-layer origin (which sits
   * at horizontal-center / top of the viewport), so centering horizontally is x:0 and the focus rides
   * at the vertical middle. Independent of the focus's layout coordinates — those are absorbed by the
   * transform (see the pan-layer), which is what keeps an expansion from moving the focus.
   */
  const fitToFocus = useCallback(() => {
    const vh = viewportRef.current?.clientHeight ?? 480;
    setPan({ x: 0, y: vh * 0.5 });
  }, []);

  // Center on the focus once, at first paint. Never on expansion (that would yank the viewport).
  useEffect(() => {
    fitToFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Background top-up: keep one layer past the frontier loaded (spec §7) -----------------------
  // After every render, look at drawn nodes whose kin flags say more exists at the boundary
  // (hasHiddenParents/Children) OR whose neighbors aren't yet loaded, and quietly fetch a subtree
  // centered on them. Best-effort, deduped by center id, never blocks an interaction.
  useEffect(() => {
    // Frontier = drawn identified nodes that still have hidden kin either direction.
    const frontier: string[] = [];
    for (const p of layout.placed) {
      if (!p.node.identified) continue;
      if ((p.node.hasHiddenParents || p.node.hasHiddenChildren) && !toppedUp.current.has(p.personId)) {
        frontier.push(p.personId);
      }
    }
    if (frontier.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const center of frontier.slice(0, 4)) {
        if (cancelled || toppedUp.current.has(center)) continue;
        toppedUp.current.add(center);
        try {
          const res = await fetchSubtree(familyId, center);
          if (cancelled || !res.ok) continue;
          setNodes((prev) => mergeNodes(prev, res.data.nodes));
          setEdges((prev) => mergeEdges(prev, res.data.edges));
        } catch {
          // Quiet — top-up is best-effort; the caret still works from prefetched knowledge.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when the drawn frontier changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.placed.length, nodes.length]);

  // --- Caret / "+" activation --------------------------------------------------------------------
  const onAffordance = useCallback(
    (a: Affordance) => {
      if (a.kind === "add") {
        const relation =
          a.direction === "parents" ? "parent" : a.direction === "siblings" ? "sibling" : "child";
        router.push(`/hub/kin?scope=${familyId}&anchor=${a.ownerId}&relation=${relation}`);
        return;
      }
      // caret: expand ⇄ collapse, client-only (spec §7).
      setExpansion((e) => {
        if (a.direction === "parents") {
          return a.expanded
            ? { ...e, collapsedParents: add(e.collapsedParents, a.ownerId), expandedParents: remove(e.expandedParents, a.ownerId) }
            : { ...e, expandedParents: add(e.expandedParents, a.ownerId), collapsedParents: remove(e.collapsedParents, a.ownerId) };
        }
        if (a.direction === "siblings") {
          return a.expanded
            ? { ...e, collapsedSiblings: add(e.collapsedSiblings, a.ownerId), expandedSiblings: remove(e.expandedSiblings, a.ownerId) }
            : { ...e, expandedSiblings: add(e.expandedSiblings, a.ownerId), collapsedSiblings: remove(e.collapsedSiblings, a.ownerId) };
        }
        // children (per couple)
        const ck = a.coupleId ?? coupleKey(a.ownerId);
        return a.expanded
          ? { ...e, collapsedChildren: add(e.collapsedChildren, ck), expandedChildren: remove(e.expandedChildren, ck) }
          : { ...e, expandedChildren: add(e.expandedChildren, ck), collapsedChildren: remove(e.collapsedChildren, ck) };
      });
    },
    [familyId, router],
  );

  // --- Drag-to-pan (viewport background) ---------------------------------------------------------
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

  // --- Node activation (name click / keyboard SELECTS; a drag does not) --------------------------
  const onNodePointerDown = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    tapRef.current = { id, x: e.clientX, y: e.clientY };
    didDragRef.current = false;
  };
  const onNodePointerMove = (id: string, e: React.PointerEvent) => {
    const t = tapRef.current;
    if (!t || t.id !== id) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > DRAG_SLOP) didDragRef.current = true;
  };
  const onNodePointerUp = (_id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    tapRef.current = null;
  };
  const onNodeActivate = (id: string) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    setSelected(id);
  };

  const selectedNode = selected ? (nodeById.get(selected) ?? null) : null;

  return (
    <div style={{ position: "relative" }}>
      {/* Controls (no global kebab — spec §2). */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button
          type="button"
          onClick={fitToFocus}
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
      </div>

      {/* Canvas viewport */}
      <div
        ref={viewportRef}
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
            // Anchor the camera on the focus: subtracting its layout position makes the focus the fixed
            // origin, so re-normalization on expand/collapse (which shifts every node's coords by a
            // generation-step) leaves the focus — and thus the whole viewport — visually stationary.
            transform: `translate(${pan.x - focusPos.x}px, ${pan.y - focusPos.y}px)`,
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

          {/* Node cards. Identified cards carry a per-card ⋮; anonymous bridges are inert. */}
          {layout.placed.map((p) => {
            const c = countsFor(p.personId);
            const inert = isAnonymousBridge(p.node);
            return (
              <div
                key={p.personId}
                data-testid={`tree-node-pos-${p.personId}`}
                onPointerDown={(e) => onNodePointerDown(p.personId, e)}
                onPointerMove={(e) => onNodePointerMove(p.personId, e)}
                onPointerUp={(e) => onNodePointerUp(p.personId, e)}
                style={{ position: "absolute", left: p.x - NODE_W / 2, top: p.y - NODE_H / 2 }}
              >
                <PersonNode
                  node={p.node}
                  onTap={onNodeActivate}
                  kebab={
                    inert ? undefined : (
                      <KebabMenu
                        node={p.node}
                        familyId={familyId}
                        parentCount={c.parents}
                        partnerCount={c.partners}
                      />
                    )
                  }
                />
              </div>
            );
          })}

          {/* Per-direction carets / "+" (1px circular border). */}
          {layout.affordances.map((aff) => (
            <AffordanceButton
              key={`${aff.direction}:${aff.ownerId}:${aff.coupleId ?? ""}`}
              aff={aff}
              onActivate={onAffordance}
            />
          ))}
        </div>
      </div>

      {selectedNode && (
        <PersonPanel
          node={selectedNode}
          familyId={familyId}
          relationToViewer={viewerRelation.get(selectedNode.personId) ?? null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** A thin caret glyph pointing UP by default; rotated to point down. */
function Caret({ down }: { down: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 20 20"
      aria-hidden="true"
      style={{ display: "block", transform: down ? "rotate(180deg)" : undefined }}
    >
      <polyline
        points="5,12.5 10,7.5 15,12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * One directional affordance in a card's gutter (spec §3). A "caret" points OUTWARD when it will expand
 * (collapsed) and INWARD when it will collapse (expanded); an "add" shows a "+". Both carry a 1px
 * circular border. Orientation per direction:
 *   - parents ↑: up = collapsed, down = expanded.
 *   - children ↓: up = collapsed, down = expanded (glyph rotated for the bottom gutter).
 *   - siblings ↔: rotated ±90° toward/away from the card; left-side vs right-side handled by rotation.
 */
function AffordanceButton({
  aff,
  onActivate,
}: {
  aff: Affordance;
  onActivate: (a: Affordance) => void;
}) {
  const label = affordanceLabel(aff);
  const size = 22;

  // Vertical carets (parents/children): down = expanded, up = collapsed (spec §3).
  const down =
    aff.kind === "caret" && (aff.direction === "parents" || aff.direction === "children")
      ? aff.expanded
      : false;

  // Siblings: point toward the card when collapsed, away when expanded. Left side: away = left (rotate
  // -90 → points left); toward = right (rotate 90). Right side mirrors.
  let siblingRotate = 0;
  if (aff.direction === "siblings" && aff.kind === "caret") {
    const away = aff.expanded;
    if (aff.side === "left") siblingRotate = away ? -90 : 90;
    else siblingRotate = away ? 90 : -90;
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={`tree-affordance-${aff.direction}-${aff.kind}-${aff.ownerId}`}
      data-affordance-kind={aff.kind}
      data-affordance-expanded={aff.expanded ? "true" : "false"}
      data-affordance-side={aff.side}
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
        border: "1px solid var(--border-strong)",
        background: "var(--surface-page)",
        color: "var(--text-meta)",
        cursor: "pointer",
        padding: 0,
        fontSize: "0.95rem",
        fontWeight: 500,
        lineHeight: 1,
        zIndex: 1,
      }}
    >
      {aff.kind === "add" ? (
        <span aria-hidden="true">{"+"}</span>
      ) : aff.direction === "siblings" ? (
        <span aria-hidden="true" style={{ display: "block", transform: `rotate(${siblingRotate}deg)` }}>
          <Caret down={false} />
        </span>
      ) : (
        <Caret down={down} />
      )}
    </button>
  );
}

function affordanceLabel(aff: Affordance): string {
  if (aff.direction === "parents") {
    if (aff.kind === "add") return hub.tree.kebabAddParent;
    return aff.expanded ? hub.tree.collapseParents : hub.tree.expandParents;
  }
  if (aff.direction === "siblings") {
    if (aff.kind === "add") return hub.tree.kebabAddSibling;
    return aff.expanded ? hub.tree.collapseSiblings : hub.tree.expandSiblings;
  }
  // children
  if (aff.kind === "add") return hub.tree.kebabAddChild;
  return aff.expanded ? hub.tree.collapseChildren : hub.tree.expandChildren;
}
