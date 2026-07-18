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
import type { KinListEntry, KinshipTreeData, UnplacedMember } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { TreeCanvas, type TreeCanvasHandle } from "../tree/tree-canvas";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../tree/tree-constants";
import { KinList } from "./KinList";
import { UnplacedMembers } from "./UnplacedMembers";
import { FamilyChips } from "../FamilyChips";
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
  families = [],
  scopeId,
}: FamilyTabProps) {
  const router = useRouter();

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

  // The family-selector row carries the chip bar (>=2 families) and, in the tree view, the zoom
  // controls. Skip it entirely when it would be empty — i.e. the List view with a self-hiding chip bar
  // (<2 families) — so a single-family relatives list doesn't gain a stray empty gap above it.
  const showFamilyRow = view === "tree" || families.length >= 2;

  return (
    <div>
      {/* Family-selector row (#159): the single-select family chips on the LEFT (ADR-0021 §Tree #48),
          and the tree's Fit / − / + controls right-justified on the SAME row (tree view only). In the
          tree view the row renders even when the chip bar self-hides (<2 families) so the tree still
          gets its zoom controls; `margin-left:auto` on the controls keeps them hard-right regardless. */}
      {showFamilyRow && (
      <div className={styles.familyRow}>
        <FamilyChips singleSelect inline families={families} selected={[scopeId ?? familyId]} />

        {view === "tree" && (
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
        )}
      </div>
      )}

      {view === "tree" ? (
        <>
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
          />
          {/* #161: unplaced members as a "not yet connected" tray BELOW the canvas — a separate strip
              at the margin, deliberately OUTSIDE computeTreeLayout / the pan-zoom layer so it never
              destabilizes the pedigree layout engine. */}
          {unplacedPanel}
        </>
      ) : (
        <>
          <KinList kin={kin} />
          {unplacedPanel}
        </>
      )}
    </div>
  );
}
