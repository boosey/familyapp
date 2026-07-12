"use client";
/**
 * TreeCanvas — the interactive visual family tree (pedigree-nav redesign, spec §"tree-canvas.tsx").
 *
 * Owns the loaded `nodes`/`edges`, the `expansion` state (starts EMPTY_EXPANSION), the client-side
 * `rootPersonId` (re-rooting is a smooth client re-fetch, not a page navigation), and a `pan` offset.
 * Renders an SVG connector layer with absolutely-positioned HTML node cards over it (so node cards are
 * real, tappable, accessible buttons while connectors stay crisp SVG). Supports drag-to-pan and a
 * **Fit** button that reframes on the root. No zoom (v1).
 *
 * Interaction model (pedigree-nav):
 *   - A node NAME click SELECTS it → opens the read-only <PersonPanel>. Re-rooting happens ONLY via the
 *     panel's "Center tree here" button (the old select→second-tap re-root gesture is GONE).
 *   - A pointer that MOVES beyond a small threshold between down and up is a drag (pan), not a tap — so
 *     panning never accidentally selects a node.
 *   - Frontier CHEVRONS on a node's outer edge reveal more ancestors/descendants (fetch + merge).
 *   - EMPTY-PARENT SLOTS on a node's ancestor edge navigate to the add-parent flow (bridge creation).
 *   - A global toolbar ⋮ (KebabMenu) and optional per-card ⋮ add relatives, gated by loaded adjacency.
 *
 * The layout function (./tree-layout) is pure and re-runs on every render from (nodes, edges, root,
 * expansion). Fetch-on-reveal merges a fetched subtree (dedup by personId / edge key), then re-lays out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { hub } from "@/app/_copy";
import type { KinshipTreeData, ResolvedKinshipEdge, TreeNode } from "@chronicle/core";
import {
  computeTreeLayout,
  EMPTY_EXPANSION,
  type EmptyParentSlot,
  type ExpansionState,
  type FrontierChevron,
} from "./tree-layout";
import { NODE_H, NODE_W, PersonNode } from "./person-node";
import { PersonPanel } from "./person-panel";
import { KebabMenu } from "./kebab-menu";
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

/** Return an immutable set copy with `value` added. */
function add<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  next.add(value);
  return next;
}

/** Loaded adjacency counts per person, for the kebab gates (parents ≤2, partner ≤1 in v1). */
interface AdjCounts {
  parents: number; // # of loaded parent_of edges where this person is the CHILD
  partners: number; // # of loaded partnered_with edges touching this person
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
      get(e.personBId).parents += 1; // B is the child
      get(e.personAId); // ensure the parent has an entry too
    } else {
      get(e.personAId).partners += 1;
      get(e.personBId).partners += 1;
    }
  }
  return m;
}

/** How far (px) a pointer may move between down and up and still count as a tap, not a drag. */
const DRAG_SLOP = 6;
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
  // Drag-vs-tap guard shared by the pointer path AND the native click path (keyboard Enter/Space fire
  // a click with NO pointer events, so this stays false and the click opens the panel — a11y). A
  // pointer drag beyond the slop flips it true, suppressing the subsequent synthetic click.
  const didDragRef = useRef(false);

  const layout = useMemo(
    () => computeTreeLayout({ nodes, edges, rootPersonId, expansion }),
    [nodes, edges, rootPersonId, expansion],
  );

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.personId, n])), [nodes]);
  const adj = useMemo(() => adjacencyCounts(edges), [edges]);
  const countsFor = useCallback(
    (id: string): AdjCounts => adj.get(id) ?? { parents: 0, partners: 0 },
    [adj],
  );

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

  // --- Smooth client-side re-root (panel "Center tree here" is the only trigger) -----------------
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

  // --- Frontier reveal fetch (a chevron on a node's outer edge) -----------------------------------
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

  /** A chevron reveals ancestors (fetch parents) or descendants (fetch children). */
  const onChevron = useCallback(
    (c: FrontierChevron) => {
      void revealFetch(c.direction === "ancestors" ? "parents" : "children", c.personId);
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

  // --- Reliable node activation (name click / keyboard SELECTS; a drag does not) ------------
  // Selection is driven by the node button's native onClick (`onNodeActivate`), which fires for BOTH
  // mouse taps AND keyboard Enter/Space. The pointer handlers only maintain the drag guard so a pan
  // that starts on a card doesn't turn into a selection when the synthetic click lands.
  const onNodePointerDown = (id: string, e: React.PointerEvent) => {
    e.stopPropagation(); // don't let the viewport treat this as a pan-start
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
  /** Native click (mouse tap OR keyboard Enter/Space). Opens the panel unless a drag was in progress. */
  const onNodeActivate = (id: string) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return; // a pan gesture, not a tap
    }
    setSelected(id); // select + open the read-only panel (no re-root gesture); idempotent
  };

  const selectedNode = selected ? (nodeById.get(selected) ?? null) : null;
  const rootNode = nodeById.get(rootPersonId) ?? null;
  const rootCounts = countsFor(rootPersonId);

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
        {/* Global add-relative ⋮ targeting the current focal root. */}
        {rootNode && (
          <span data-testid="tree-toolbar-kebab" style={{ marginLeft: "auto" }}>
            <KebabMenu
              node={rootNode}
              familyId={familyId}
              parentCount={rootCounts.parents}
              partnerCount={rootCounts.partners}
            />
          </span>
        )}
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

          {/* Node cards. Each carries an optional per-card ⋮ wired with that node's adjacency counts. */}
          {layout.placed.map((p) => {
            const c = countsFor(p.personId);
            return (
              <div
                key={p.personId}
                onPointerDown={(e) => onNodePointerDown(p.personId, e)}
                onPointerMove={(e) => onNodePointerMove(p.personId, e)}
                onPointerUp={(e) => onNodePointerUp(p.personId, e)}
                style={{ position: "absolute", left: p.x - NODE_W / 2, top: p.y - NODE_H / 2 }}
              >
                <PersonNode
                  node={p.node}
                  isRoot={p.personId === rootPersonId}
                  viewerPersonId={viewerPersonId}
                  onTap={onNodeActivate}
                  kebab={
                    <KebabMenu
                      node={p.node}
                      familyId={familyId}
                      parentCount={c.parents}
                      partnerCount={c.partners}
                    />
                  }
                />
              </div>
            );
          })}

          {/* Frontier chevrons — reveal more ancestors (right edge) / descendants (left edge). */}
          {layout.chevrons.map((ch) => (
            <ChevronButton key={`${ch.direction}:${ch.personId}`} chevron={ch} onActivate={onChevron} />
          ))}

          {/* Empty-parent slots — navigate to the add-parent flow (bridge creation). */}
          {layout.emptyParentSlots.map((slot) => (
            <EmptyParentSlotButton key={slot.personId} slot={slot} familyId={familyId} />
          ))}
        </div>
      </div>

      {selectedNode && (
        <PersonPanel
          node={selectedNode}
          isRoot={selectedNode.personId === rootPersonId}
          familyId={familyId}
          viewerPersonId={viewerPersonId}
          onRecenter={(id) => void recenterOn(id)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** A single frontier chevron (reveal ancestors on the right edge, descendants on the left edge). */
function ChevronButton({
  chevron,
  onActivate,
}: {
  chevron: FrontierChevron;
  onActivate: (c: FrontierChevron) => void;
}) {
  // Ancestors sit on the RIGHT edge → chevron points right (▸). Descendants on the LEFT edge → left (◂).
  const glyph = chevron.direction === "ancestors" ? "▸" : "◂";
  const label = chevron.direction === "ancestors" ? hub.tree.showEarlier : hub.tree.showDescendants;
  const size = 22;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={`tree-chevron-${chevron.direction}-${chevron.personId}`}
      onClick={(e) => {
        e.stopPropagation();
        onActivate(chevron);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: chevron.x - size / 2,
        top: chevron.y - size / 2,
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

/** An inline "add parent" placeholder on a node's ancestor edge → the add-parent flow (bridge). */
function EmptyParentSlotButton({ slot, familyId }: { slot: EmptyParentSlot; familyId: string }) {
  const label = hub.tree.addParentSlot;
  const size = 22;
  return (
    <Link
      href={`/hub/kin?scope=${familyId}&anchor=${slot.personId}&relation=parent`}
      aria-label={label}
      title={label}
      data-testid={`tree-addparentslot-${slot.personId}`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: slot.x - size / 2,
        top: slot.y - size / 2,
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: "var(--border-width) dashed var(--border-strong)",
        background: "var(--surface-card)",
        color: "var(--text-muted)",
        cursor: "pointer",
        fontSize: "0.9rem",
        fontWeight: 500,
        lineHeight: 1,
        padding: 0,
        textDecoration: "none",
        zIndex: 1,
      }}
    >
      <span aria-hidden="true">{"+"}</span>
    </Link>
  );
}
