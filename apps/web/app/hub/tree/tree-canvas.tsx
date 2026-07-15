"use client";
/**
 * TreeCanvas — the interactive ego-centric visual family tree (spec 2026-07-13, §1–§8).
 *
 * Owns the loaded `nodes`/`edges`, the `expansion` state, a `pan` offset, and a `scale` (zoom). Renders
 * an SVG connector layer with absolutely-positioned HTML node cards over it (real, tappable, accessible
 * buttons over crisp SVG). Drag-to-pan; **Fit** zooms the whole loaded tree to the viewport; +/− step
 * the zoom about the focus (2026-07-14 — the tree is a hub tab now, and zoom/fit were added).
 *
 * Interaction model:
 *   - A node NAME click opens the read-only <PersonPanel>. It never re-roots.
 *   - Per-direction CARETS (parents ↑, siblings ↔, children ↓) expand/collapse a branch — CLIENT ONLY,
 *     instant, off the fetch path (spec §7: every drawn card's immediate kin is already loaded).
 *   - A "+" where a direction has no kin opens the Add-a-relative MODAL (via TreeAddProvider); the
 *     per-card ⋮ (KebabMenu) and the person panel open the same modal. No route navigation (/hub/kin is
 *     gone); on a successful add the anchor's subtree is refetched so the new relative appears.
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
import { hub } from "@/app/_copy";
import type {
  AddRelativeRelation,
  KinshipTreeData,
  ResolvedKinshipEdge,
  TreeNode,
} from "@chronicle/core";
// Client-safe kinship derivation (type-only server barrel avoided — no node:crypto in the bundle).
import { deriveKin, type KinRelation } from "@chronicle/core/kinship-derive";
import {
  computeTreeLayout,
  EMPTY_EXPANSION,
  roundedPath,
  toggleAffordanceExpansion,
  type Affordance,
  type ExpansionState,
} from "./tree-layout";
import { PersonNode, isAnonymousBridge } from "./person-node";
import {
  AFFORDANCE_SIZE_PX,
  DRAG_SLOP_PX,
  FIT_MARGIN,
  FIT_MAX_SCALE,
  NODE_H,
  NODE_W,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from "./tree-constants";
import { PersonPanel } from "./person-panel";
import { KebabMenu } from "./kebab-menu";
import { mergeEdges, mergeNodes } from "./merge";
import { fetchSubtreeAction, type FetchSubtreeResult } from "./actions";
import { TreeAddProvider, type OpenAddRelative } from "./add-relative-context";
import { AddRelativeModal } from "./add-relative-modal";

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

// Drag/zoom/fit knobs live in ./tree-constants (imported above).

const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

interface AddTarget {
  anchorPersonId: string;
  relation: AddRelativeRelation;
  /** For a couple's child add: the OTHER partner, pre-bound so the click predetermines both parents. */
  coParentPersonId?: string;
}

export function TreeCanvas({
  familyId,
  focusPersonId,
  viewerPersonId,
  initial,
  fetchSubtree = fetchSubtreeAction,
}: TreeCanvasProps) {
  const [nodes, setNodes] = useState<TreeNode[]>(initial.nodes);
  const [edges, setEdges] = useState<ResolvedKinshipEdge[]>(initial.edges);
  const [expansion, setExpansion] = useState<ExpansionState>(EMPTY_EXPANSION);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);

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

  // Which cards get an inner-bottom corner flattened: both halves of any drawn couple that carries a
  // children affordance (its seam glyph hugs the seam, so the borders should run straight under it). The
  // affordance's `ownerId` is the LEFT partner; the other member of `coupleId` is the RIGHT partner.
  const squareCornerByPerson = useMemo(() => {
    const m = new Map<string, "bottom-left" | "bottom-right">();
    for (const a of layout.affordances) {
      if (a.direction !== "children" || !a.coupleId || !a.coupleId.includes("|")) continue;
      const [x, y] = a.coupleId.split("|");
      const leftId = a.ownerId;
      const rightId = x === leftId ? y! : x!;
      m.set(leftId, "bottom-right"); // left card → flatten its inner (right) corner
      m.set(rightId, "bottom-left"); // right card → flatten its inner (left) corner
    }
    return m;
  }, [layout.affordances]);

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
   * Center on the focus at 1× (the ego-centric default framing). `pan` is the focus's on-screen offset
   * from the pan-layer origin (horizontal-center / top of the viewport), so centering horizontally is
   * x:0 and the focus rides at the vertical middle. The focus's layout coordinates are absorbed by the
   * transform (see the pan-layer), which is what keeps an expansion from moving the focus.
   */
  const centerOnFocus = useCallback(() => {
    const vh = viewportRef.current?.clientHeight ?? 480;
    setScale(1);
    setPan({ x: 0, y: vh * 0.5 });
  }, []);

  // The pan-layer transform is `translate(pan) · scale(s) · translate(-focus)` with origin 0,0, so a
  // layout point p lands at screen (vw/2 + pan.x + s·(p.x−focus.x), pan.y + s·(p.y−focus.y)). `Fit`
  // (spec 2026-07-14) now actually ZOOMS the whole loaded tree to fit the viewport and centers its
  // bounding box — the old "Fit" only recentred the focus at 1× (no scaling).
  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    const vw = vp?.clientWidth ?? 640;
    const vh = vp?.clientHeight ?? 480;
    const bw = Math.max(1, layout.bounds.width);
    const bh = Math.max(1, layout.bounds.height);
    const s = clampScale(
      Math.min((vw / bw) * FIT_MARGIN, (vh / bh) * FIT_MARGIN, FIT_MAX_SCALE),
    );
    // Land the bounding-box centre at the viewport centre.
    setScale(s);
    setPan({
      x: -s * (bw / 2 - focusPos.x),
      y: vh / 2 - s * (bh / 2 - focusPos.y),
    });
  }, [layout.bounds.width, layout.bounds.height, focusPos.x, focusPos.y]);

  // Zoom in/out about the focus. Scale is applied around the focus (see the transform), so the focus
  // stays put and only `scale` changes — pan is untouched.
  const zoomBy = useCallback((factor: number) => {
    setScale((s) => clampScale(s * factor));
  }, []);

  // Center on the focus once, at first paint. Never on expansion (that would yank the viewport).
  useEffect(() => {
    centerOnFocus();
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

  // --- Add-a-relative (modal over the tree, spec 2026-07-14) -------------------------------------
  // The "+" gutter buttons, the per-card ⋮ menu, and the person panel all open ONE Add modal now
  // (/hub/kin is gone). `openAdd` is shared with those child components via TreeAddProvider.
  const openAdd: OpenAddRelative = useCallback((anchorPersonId, relation, coParentPersonId) => {
    setAddTarget({ anchorPersonId, relation, coParentPersonId });
  }, []);

  // After a successful add, top the anchor's subtree back up so the new relative appears, then close.
  const refetchAnchor = useCallback(
    async (anchorId: string) => {
      toppedUp.current.delete(anchorId);
      try {
        const res = await fetchSubtree(familyId, anchorId);
        if (res.ok) {
          setNodes((p) => mergeNodes(p, res.data.nodes));
          setEdges((p) => mergeEdges(p, res.data.edges));
        }
      } catch {
        /* best-effort — a refresh will reconcile. */
      }
    },
    [familyId, fetchSubtree],
  );

  // The anchor's partners (for the modal's "Other parent" picker) — the OTHER endpoint of every
  // partnered_with edge touching the anchor, named from the loaded nodes.
  const partnersOf = useCallback(
    (anchorId: string): { id: string; name: string }[] => {
      const out: { id: string; name: string }[] = [];
      for (const e of edges) {
        if (e.edgeType !== "partnered_with") continue;
        const otherId =
          e.personAId === anchorId ? e.personBId : e.personBId === anchorId ? e.personAId : null;
        if (!otherId) continue;
        const n = nodeById.get(otherId);
        out.push({
          id: otherId,
          name: n?.identified && n.displayName ? n.displayName : hub.kin.edgeUnknownPerson,
        });
      }
      return out;
    },
    [edges, nodeById],
  );

  // --- Caret / "+" activation --------------------------------------------------------------------
  const onAffordance = useCallback(
    (a: Affordance) => {
      if (a.kind === "add") {
        const relation: AddRelativeRelation =
          a.direction === "parents" ? "parent" : a.direction === "siblings" ? "sibling" : "child";
        // A couple's child-"+" predetermines the co-parent: the OTHER member of coupleId (a|b). Single
        // parents (coupleId is their own id, no "|") and non-child adds carry no co-parent.
        let coParentPersonId: string | undefined;
        if (a.direction === "children" && a.coupleId && a.coupleId.includes("|")) {
          const [x, y] = a.coupleId.split("|");
          coParentPersonId = x === a.ownerId ? y : x;
        }
        openAdd(a.ownerId, relation, coParentPersonId);
        return;
      }
      // caret: expand ⇄ collapse, client-only (spec §7). The reducer enforces the Rule-8 sibling⇄parent
      // coupling (expanding siblings auto-expands parents; collapsing parents collapses siblings).
      setExpansion((e) =>
        toggleAffordanceExpansion(e, {
          direction: a.direction,
          ownerId: a.ownerId,
          coupleId: a.coupleId,
          expanded: a.expanded,
        }),
      );
    },
    [openAdd],
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
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > DRAG_SLOP_PX) didDragRef.current = true;
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
    <TreeAddProvider value={openAdd}>
    <div style={{ position: "relative" }}>
      {/* Controls (no global kebab — spec §2). Fit zooms-to-fit; +/− step the zoom about the focus. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button
          type="button"
          onClick={fitToView}
          data-testid="tree-fit"
          style={controlPill}
        >
          {hub.tree.fit}
        </button>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            data-testid="tree-zoom-out"
            aria-label={hub.tree.zoomOut}
            disabled={scale <= ZOOM_MIN + 0.001}
            style={zoomBtn(scale <= ZOOM_MIN + 0.001)}
          >
            <span aria-hidden="true">−</span>
          </button>
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_STEP)}
            data-testid="tree-zoom-in"
            aria-label={hub.tree.zoomIn}
            disabled={scale >= ZOOM_MAX - 0.001}
            style={zoomBtn(scale >= ZOOM_MAX - 0.001)}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
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
            // Anchor the camera on the focus: `translate(pan) · scale · translate(-focus)` (origin 0,0)
            // makes the focus the fixed origin — re-normalization on expand/collapse (which shifts every
            // node's coords by a generation-step) leaves the focus visually stationary, and a scale
            // change zooms ABOUT the focus (it stays put; only `scale` moves). At scale=1 this is exactly
            // the old `translate(pan − focus)`.
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale}) translate(${-focusPos.x}px, ${-focusPos.y}px)`,
            transformOrigin: "0 0",
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
            {/* Only descent buses are drawn — same-row cards (partners, siblings) are never joined by a
                direct line; a partnership reads from proximity and connects down through this bus. The
                U / inverted-U corners are rounded at paint time (the layout emits exact polylines). */}
            {layout.connectors.map((c, i) => (
              <path
                key={i}
                d={roundedPath(c.d, 8)}
                fill="none"
                stroke="var(--border-strong)"
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
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
                  squareCorner={squareCornerByPerson.get(p.personId)}
                  kebab={
                    inert ? undefined : (
                      <KebabMenu
                        node={p.node}
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
          relationToViewer={viewerRelation.get(selectedNode.personId) ?? null}
          onClose={() => setSelected(null)}
        />
      )}

      {addTarget && (
        <AddRelativeModal
          familyId={familyId}
          anchorPersonId={addTarget.anchorPersonId}
          initialRelation={addTarget.relation}
          coParentOptions={partnersOf(addTarget.anchorPersonId)}
          preselectedCoParentId={addTarget.coParentPersonId}
          onClose={() => setAddTarget(null)}
          onSuccess={() => {
            const anchor = addTarget.anchorPersonId;
            setAddTarget(null);
            void refetchAnchor(anchor);
          }}
        />
      )}
    </div>
    </TreeAddProvider>
  );
}

const controlPill: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  fontWeight: 600,
  padding: "8px 16px",
  borderRadius: "var(--radius-pill)",
  border: "var(--border-width) solid var(--border-strong)",
  background: "transparent",
  color: "var(--text-body)",
  cursor: "pointer",
};

function zoomBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "var(--border-width) solid var(--border-strong)",
    background: "transparent",
    color: "var(--text-body)",
    fontSize: "1.2rem",
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    padding: 0,
  };
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
  const size = AFFORDANCE_SIZE_PX;

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
