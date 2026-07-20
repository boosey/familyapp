"use client";
/**
 * FamilyTab — the hub's "Family" tab content (the visual tree + the relatives list). The tree used to
 * be a standalone `/hub/tree` route and the relatives list a separate `/hub/kin` route; both are folded
 * in here.
 *
 *   - Tree view → the interactive <TreeCanvas> (pan/zoom, per-card add via modal).
 *   - List  view → the searchable read-only <KinList> of the viewer's relatives.
 *
 * The Tree/List selection is URL-driven now (#158): the `Family tree · List · Requests` selector lives
 * in <FamilySurfaceNav> (rendered by the page shell) and this component simply renders whichever `view`
 * the page resolved from `?view=`. There is no localStorage toggle and no in-tab pill anymore.
 *
 * This component owns ONLY the family-selector row (#159): the shared single-select <FamilyChips>
 * (`?families=`) with the tree's `Fit / − / +` controls right-justified on the same row (tree view
 * only). Camera state (pan/scale) is lifted here so those controls can drive the canvas.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GovernableKinEdge, KinListEntry, KinshipTreeData, UnplacedMember } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { TreeCanvas, type TreeCanvasHandle } from "../tree/tree-canvas";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../tree/tree-constants";
import { KinList } from "./KinList";
import { UnplacedMembers } from "./UnplacedMembers";
import { GovernableEdgesSection } from "./GovernableEdgesSection";
import { FamilyChips } from "../FamilyChips";
import { FamilySurfaceNav, type FamilySurfaceView } from "../FamilySurfaceNav";
import { useIsCompact } from "@/app/_kindred/useIsCompact";
import styles from "./FamilyTab.module.css";

const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

export type FamilyView = "tree" | "list";

export interface FamilyTabProps {
  familyId: string;
  focusPersonId: string;
  viewerPersonId: string;
  tree: KinshipTreeData;
  kin: KinListEntry[];
  /** Which view to render — resolved by the page shell from `?view=` (#158). Defaults to the tree. */
  view?: FamilyView;
  /**
   * #161/ADR-0023 — active members placed in NO visible kinship edge. Surfaced as a "not yet
   * connected" tray (Tree view) and section (List view) with place/non-family/remove actions.
   */
  unplaced?: UnplacedMember[];
  /** Steward-only: gates the destructive "remove member" action in the unplaced surface. */
  viewerIsSteward?: boolean;
  /**
   * #254 — visible edges with Remove/Hide capability flags (from `listGovernableKinEdges`). Threaded
   * into the tree's PersonDetails and the List-view relationships section.
   */
  governableEdges?: GovernableKinEdge[];
  /**
   * The viewer's active families (chip data for the shared `?families=` filter, ADR-0021 §Tree #48).
   * The server gates the MOUNT on `families.length >= 2`, so this only carries chips when a chip bar is
   * warranted; a 0/1-family viewer receives `undefined`/`[]` and no chip bar renders.
   */
  families?: { id: string; name: string; shortName?: string | null }[];
  /**
   * The single resolved scope id the tree is currently rendering (page's `familyTabFamilyId`). Passed
   * as the single-select ON chip. Arriving with SEVERAL families selected already resolves to the
   * first one server-side (`deriveSingleScope` → ids[0], collapsed into `familyTabFamilyId`), so the
   * chip bar just reflects `[scopeId]` — no client-side "first of set" logic needed here.
   */
  scopeId?: string;
  /**
   * R1 slot data for the shared {@link FamilySurfaceNav}/HubToolbar (#189). The Family CONTENT tabs
   * render the full two-row toolbar here (R1 = selector + Invite, R2 = this component's family selector
   * + zoom controls) so it's ONE toolbar block, not a page-level R1 above a separate in-tab R2. These
   * are the same values the page hands the standalone FamilySurfaceNav on the Requests / no-family path.
   */
  surface: {
    /** Which selector item is active — `"tree"`/`"list"` here (Requests is never the content tab). */
    active: FamilySurfaceView;
    familiesParam: string | null;
    showRequests: boolean;
    requestsBadge?: number;
    inviteHref?: string;
  };
}

export function FamilyTab({
  familyId,
  focusPersonId,
  viewerPersonId,
  tree,
  kin,
  view = "tree",
  unplaced = [],
  viewerIsSteward = false,
  governableEdges = [],
  families = [],
  scopeId,
  surface,
}: FamilyTabProps) {
  const router = useRouter();
  // ADR-0025 device round: on a phone the zoom controls float ON the tree canvas (a bottom sheet would
  // cover the tree being zoomed), and the family chips move into the strip's Family IconSheet — so we
  // do NOT hand the zoom controls to FamilySurfaceNav on compact. SSR/first-paint = desktop.
  const compact = useIsCompact();

  // #169: unplaced members fetch their anchor list family-wide (no longer limited to the tree
  // window), so the parent no longer needs to compute anchorOptions from tree.nodes.
  const unplacedPanel =
    unplaced.length > 0 ? (
      <UnplacedMembers
        familyId={familyId}
        members={unplaced}
        viewerIsSteward={viewerIsSteward}
        variant={view === "tree" ? "tray" : "section"}
      />
    ) : null;

  // CAMERA state lifted out of TreeCanvas (§5) so the Fit/−/+ controls can live in the family-selector
  // row. TreeCanvas keeps `fit()`/`center()` (they need layout bounds + the viewport ref) behind an
  // imperative handle; Fit calls it. Zoom −/+ are simple clamped setScale calls owned here.
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const canvasRef = useRef<TreeCanvasHandle | null>(null);

  const atMin = scale <= ZOOM_MIN + 0.001;
  const atMax = scale >= ZOOM_MAX - 0.001;

  // R2 (the family-selector row) content, handed to the shared HubToolbar via FamilySurfaceNav. Compute
  // EMPTINESS here rather than letting the toolbar guess: FamilyChips self-renders null for <2 families,
  // but a <FamilyChips/> element is still a truthy node — so gate on families.length so the toolbar's
  // empty-row rule fires. This preserves the old `showFamilyRow = tree || >=2 families` behaviour exactly
  // (List view + <2 families → no R2 → content flush, no stray gap).
  const familyChips =
    families.length >= 2 ? (
      <FamilyChips
        singleSelect
        inline
        families={families}
        selected={[scopeId ?? familyId]}
        // ADR-0024: the chip row is a horizontal-scroll strip on a phone (wrapping restored at ≥ sm) so
        // it never bloats into ragged rows. Family's only secondary control — no "Filters & view" sheet.
        rowClassName={styles.familyChipsScroll}
      />
    ) : null;

  // The tree's Fit / − / + controls — tree view only (null in the list view → no R2-right content).
  const zoomControls =
    view === "tree" ? (
      <div className={styles.zoomControls} data-testid="tree-controls">
        <button
          type="button"
          onClick={() => canvasRef.current?.fit()}
          data-testid="tree-fit"
          className={styles.controlPill}
        >
          {hub.tree.fit}
        </button>
        <div className={styles.zoomPair}>
          <button
            type="button"
            onClick={() => setScale((s) => clampScale(s / ZOOM_STEP))}
            data-testid="tree-zoom-out"
            aria-label={hub.tree.zoomOut}
            disabled={atMin}
            className={styles.zoomBtn}
          >
            <span aria-hidden="true">−</span>
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => clampScale(s * ZOOM_STEP))}
            data-testid="tree-zoom-in"
            aria-label={hub.tree.zoomIn}
            disabled={atMax}
            className={styles.zoomBtn}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div>
      {/* The full shared two-row toolbar (#189): R1 = the Family selector + Invite (FamilySurfaceNav),
          R2 = the single-select family chips (left) and the tree's Fit/−/+ controls (right). When R2
          would be empty (List view + <2 families) HubToolbar's empty-row rule drops it, so the content
          below stays flush — the old `showFamilyRow` behaviour, now centralized in the toolbar. */}
      {/* Desktop hands the zoom controls to the toolbar's R2-right; on a phone we pass `undefined` there
          and float them on the tree canvas below instead (see the tree branch). */}
      <FamilySurfaceNav
        active={surface.active}
        familiesParam={surface.familiesParam}
        showRequests={surface.showRequests}
        requestsBadge={surface.requestsBadge}
        inviteHref={surface.inviteHref}
        row2Left={familyChips}
        row2Right={compact ? undefined : zoomControls}
      />

      {view === "tree" ? (
        <>
          {/* On a phone the zoom controls float thumb-reachable over the canvas (ADR-0024 "tree controls
              thumb-reachable"); the relative wrapper is their positioning context. On desktop they live
              in the toolbar (above), so this wrapper just holds the canvas. */}
          <div className={styles.treeFrame}>
            <TreeCanvas
              ref={canvasRef}
              familyId={familyId}
              focusPersonId={focusPersonId}
              viewerPersonId={viewerPersonId}
              initial={tree}
              pan={pan}
              onPanChange={(updater) => setPan(updater)}
              scale={scale}
              onScaleChange={(updater) => setScale(updater)}
              // Slice D (#6): client-side nav for the invite deep-link so pan/zoom state isn't lost to a
              // full reload (the rest of /hub uses router.push). TreeCanvas keeps window.location.assign as
              // its DEFAULT so it stays mountable without a router in unit tests.
              navigate={(url) => router.push(url)}
              unplacedMembers={unplaced}
              onFamilyMutation={() => router.refresh()}
              governableEdges={governableEdges}
            />
            {compact ? <div className={styles.zoomFloat}>{zoomControls}</div> : null}
          </div>
          {/* #161: unplaced members as a "not yet connected" tray BELOW the canvas — a separate strip
              at the margin, deliberately OUTSIDE computeTreeLayout / the pan-zoom layer so it never
              destabilizes the pedigree layout engine. */}
          {unplacedPanel}
        </>
      ) : (
        <>
          <KinList kin={kin} />
          {/* #254: steward Remove / subject Hide for actable edges (same controls as PersonDetails). */}
          <GovernableEdgesSection familyId={familyId} edges={governableEdges} />
          {unplacedPanel}
        </>
      )}
    </div>
  );
}
