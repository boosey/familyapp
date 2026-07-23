"use client";
/**
 * FamilyTab — the hub's "Family" tab content (the visual tree + the people list). The tree used to
 * be a standalone `/hub/tree` route and the relatives list a separate `/hub/kin` route; both are folded
 * in here.
 *
 *   - Tree view → the interactive <TreeCanvas> (pan/zoom, per-card add via modal) + unplaced tray.
 *   - List  view → searchable <KinList> of the full family people index (#283). Never hosts
 *     placement/Not-family/Remove or the unplaced tray — but #330 lets a row open the SAME
 *     <PersonDetails> sheet Tree uses (details, Edit, Stories/Photos/Mentions), with edge governance
 *     omitted (no `governableEdges` — Tree-only, #283) and Invite (#334) wired to the SAME in-place
 *     <PersonInviteModal> Tree uses.
 *
 * #337 — owns Steward Reconciliation ("This is the same person as…") for both List and Tree: opens
 * the shared picker/confirm flow, toasts on success, and focuses the winner (List highlight / Tree
 * `?anchor=` re-root).
 *
 * The Tree/List selection is URL-driven now (#158): the `Family tree · List · Requests` selector lives
 * in <FamilySurfaceNav> (rendered by the page shell) and this component simply renders whichever `view`
 * the page resolved from `?view=`. There is no localStorage toggle and no in-tab pill anymore.
 *
 * This component owns ONLY the family-selector row (#159): the shared single-select <FamilyChips>
 * (`?families=`) with the tree's `Fit / − / +` controls right-justified on the same row (tree view
 * only). Camera state (pan/scale) is lifted here so those controls can drive the canvas.
 *
 * #288 — on compact viewports, Place / New person run Place→tap person→tap zone into the shared
 * PlaceConfirmModal (desktop keeps the unlocked-receiver modal; #287 owns tray DnD).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  AddRelativeRelation,
  GovernableKinEdge,
  KinshipTreeData,
  TreeNode,
  UnplacedMember,
} from "@chronicle/core";
import { hub } from "@/app/_copy";
import { asReconcilePerson, type FamilyListPerson } from "@/lib/family-list-people";
import { resolveListPersonNode } from "@/lib/family-list-people";
import { shouldPushReconcileTreeAnchor } from "@/lib/reconcile-eligibility";
import { RECONCILE_TOAST_DISMISS_MS } from "@/lib/constants";
import { TreeCanvas, type TreeCanvasHandle } from "../tree/tree-canvas";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../tree/tree-constants";
import {
  type PlaceConfirmSubject,
} from "../tree/place-confirm";
import { PlaceConfirmModal } from "../tree/place-confirm-modal";
import { PersonDetails } from "../tree/person-details";
import { PersonInviteModal, type PersonInviteModalProps } from "../tree/PersonInviteModal";
import { ReconcileFlow } from "../kin/reconcile-flow";
import { KinList } from "./KinList";
import { UnplacedMembers } from "../tree/UnplacedMembers";
import { FamilyChips } from "../FamilyChips";
import { FamilySurfaceNav, type FamilySurfaceInvite, type FamilySurfaceView } from "../FamilySurfaceNav";
import { useIsCompact } from "@/app/_kindred/useIsCompact";
import styles from "./FamilyTab.module.css";

const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

export type FamilyView = "tree" | "list";

type MobilePlaceConfirm = {
  subject: PlaceConfirmSubject;
  receiverPersonId: string;
  receiverDisplayName: string;
  relation: AddRelativeRelation;
};

export interface FamilyTabProps {
  familyId: string;
  focusPersonId: string;
  viewerPersonId: string;
  tree: KinshipTreeData;
  /** #283 — browse-only people index for List (members + tree-only + unplaced). */
  listPeople: FamilyListPerson[];
  /** Which view to render — resolved by the page shell from `?view=` (#158). Defaults to the tree. */
  view?: FamilyView;
  /**
   * #161/ADR-0023 — active members placed in NO visible kinship edge. Surfaced as a Tree tray only
   * (#283: List is browse-only — no Place / Not-family / Remove on List).
   */
  unplaced?: UnplacedMember[];
  /** Steward-only: gates unplaced Remove and #337 Reconciliation (write paths re-check). */
  viewerIsSteward?: boolean;
  /**
   * #254 — visible edges with Remove/Hide capability flags (from `listGovernableKinEdges`). Threaded
   * into the tree's PersonDetails only — List no longer hosts governable edges (#283).
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
   * Progressive control-row data for {@link FamilySurfaceNav} (#297). The Family CONTENT tabs render
   * Sub tabs + Invite + this component's Family chips / Views (zoom) so chrome is ONE row. Same values
   * RequestsTab uses when it owns the progressive row on the Requests path.
   */
  surface: {
    /** Which selector item is active — `"tree"`/`"list"` here (Requests is never the content tab). */
    active: FamilySurfaceView;
    familiesParam: string | null;
    showRequests: boolean;
    requestsBadge?: number;
    invite?: FamilySurfaceInvite;
  };
  /**
   * #334 — overridable seams for the person-bound Invite modal (mirrors `TreeCanvas`'s own injection
   * pattern), threaded to BOTH the Tree canvas's modal and List's own modal so a single override covers
   * either view. Default to the real server actions in production; tests inject fakes.
   */
  fetchInviteTargets?: PersonInviteModalProps["fetchTargets"];
  submitInvite?: PersonInviteModalProps["submitInvite"];
}

export function FamilyTab({
  familyId,
  focusPersonId,
  viewerPersonId,
  tree,
  listPeople,
  view = "tree",
  unplaced = [],
  viewerIsSteward = false,
  governableEdges = [],
  families = [],
  scopeId,
  surface,
  fetchInviteTargets,
  submitInvite,
}: FamilyTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Compact still gates Place→tap→zone (#288); zoom/fit are the progressive Views unit (#297), not a
  // floating canvas overlay.
  const compact = useIsCompact();

  // #288 — mobile Place→tap→zone session (subject picking) + locked-receiver confirm after a zone tap.
  const [canvasPlaceSubject, setCanvasPlaceSubject] = useState<PlaceConfirmSubject | null>(null);
  const [mobilePlaceConfirm, setMobilePlaceConfirm] = useState<MobilePlaceConfirm | null>(null);

  // #330 — List's selected row opens the same PersonDetails sheet Tree uses, no governable edges.
  const [selectedListPerson, setSelectedListPerson] = useState<FamilyListPerson | null>(null);
  // #334 — List's Invite modal target, a SIBLING overlay of `selectedListPerson`'s details sheet (not
  // a replacement): closing the modal never closes the details sheet underneath it (AC 4).
  const [listInviteNode, setListInviteNode] = useState<TreeNode | null>(null);

  // #337 — steward reconcile flow (shared by List row ⋮ and Tree kebab).
  const [reconcileStartId, setReconcileStartId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [highlightedPersonId, setHighlightedPersonId] = useState<string | null>(null);

  const reconcilePool = useMemo(() => listPeople.map(asReconcilePerson), [listPeople]);
  const reconcileById = useMemo(() => {
    const m = new Map(reconcilePool.map((p) => [p.personId, p]));
    return m;
  }, [reconcilePool]);
  const reconcileStart = reconcileStartId ? (reconcileById.get(reconcileStartId) ?? null) : null;

  const openReconcile = (personId: string) => setReconcileStartId(personId);

  const onReconcileSuccess = (accountPersonId: string) => {
    setReconcileStartId(null);
    const winner = reconcileById.get(accountPersonId);
    const winnerName = winner?.displayName?.trim() || hub.reconcile.unnamed;
    setToast(hub.reconcile.successToast(winnerName));
    setHighlightedPersonId(accountPersonId);

    // Always refresh so the mention leaves the projection even when the winner is already focused
    // (`?anchor=` unchanged → push would no-op). Push only when the tree must re-root.
    if (shouldPushReconcileTreeAnchor(view, searchParams.get("anchor"), accountPersonId)) {
      const next = new URLSearchParams(searchParams.toString());
      next.set("tab", "family");
      next.set("view", "tree");
      next.set("anchor", accountPersonId);
      router.push(`${pathname}?${next.toString()}`);
    }
    router.refresh();
  };

  // #337 — auto-dismiss the success toast so it doesn't stick forever.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), RECONCILE_TOAST_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  // #169 / #286: Tree tray always mounts (unplaced members + New person). List never hosts it (#283).
  // On compact, Place/New start a canvas session instead of the unlocked-receiver modal.
  const unplacedTray =
    view === "tree" ? (
      <UnplacedMembers
        familyId={familyId}
        members={unplaced}
        viewerIsSteward={viewerIsSteward}
        variant="tray"
        showNewPerson
        onStartCanvasPlace={
          compact
            ? (subject) => {
                setMobilePlaceConfirm(null);
                setCanvasPlaceSubject(subject);
              }
            : undefined
        }
        canvasPlaceSubject={compact ? canvasPlaceSubject : null}
        onCancelCanvasPlace={
          compact
            ? () => {
                setCanvasPlaceSubject(null);
                setMobilePlaceConfirm(null);
              }
            : undefined
        }
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

  // Progressive Family unit: gate on families.length so a truthy <FamilyChips/> element never mounts an
  // empty Family icon for a single-family viewer (List + <2 families → Sub tabs only).
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
      {/* Progressive control row (#297): Sub tabs + Family chips + Views (zoom) + Invite trailing. */}
      <FamilySurfaceNav
        active={surface.active}
        familiesParam={surface.familiesParam}
        showRequests={surface.showRequests}
        requestsBadge={surface.requestsBadge}
        invite={surface.invite}
        row2Left={familyChips}
        row2Right={zoomControls}
      />

      {toast ? (
        <p role="status" aria-live="polite" data-testid="reconcile-toast" className={styles.reconcileToast}>
          {toast}
        </p>
      ) : null}

      {view === "tree" ? (
        <>
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
              unplacedMembers={unplaced}
              onFamilyMutation={() => router.refresh()}
              governableEdges={governableEdges}
              placeSubject={compact ? canvasPlaceSubject : null}
              onPlaceZoneChosen={
                compact
                  ? ({ receiverPersonId, receiverDisplayName, relation }) => {
                      if (!canvasPlaceSubject) return;
                      setMobilePlaceConfirm({
                        subject: canvasPlaceSubject,
                        receiverPersonId,
                        receiverDisplayName,
                        relation,
                      });
                      setCanvasPlaceSubject(null);
                    }
                  : undefined
              }
              fetchInviteTargets={fetchInviteTargets}
              submitInvite={submitInvite}
              reconcile={{
                viewerIsSteward,
                byPersonId: reconcileById,
                pool: reconcilePool,
                onReconcile: openReconcile,
              }}
            />
          </div>
          {/* #161/#286: Tree tray (unplaced + New person) BELOW the canvas — outside computeTreeLayout /
              the pan-zoom layer so it never destabilizes the pedigree layout engine. List does not
              host this tray (#283). */}
          {unplacedTray}
          {mobilePlaceConfirm ? (
            <PlaceConfirmModal
              familyId={familyId}
              subject={mobilePlaceConfirm.subject}
              receiver={{
                personId: mobilePlaceConfirm.receiverPersonId,
                displayName: mobilePlaceConfirm.receiverDisplayName,
              }}
              receiverLocked
              initialRelation={mobilePlaceConfirm.relation}
              onClose={() => setMobilePlaceConfirm(null)}
              onSuccess={() => {
                setMobilePlaceConfirm(null);
                router.refresh();
              }}
            />
          ) : null}
        </>
      ) : (
        // #283: no Place/Not-family/Remove/unplaced tray on List. #330: a row DOES open the same
        // PersonDetails sheet Tree uses — `governableEdges` stays omitted (edge governance is Tree-only),
        // but `onInvite` (#334) wires the SAME in-place Invite modal Tree uses. Unlike Tree's fixed-height
        // canvas frame, this wrapper grows with the (potentially long, scrollable) row list, so the sheet
        // uses `placement="viewport"` (`position: fixed`, same 12px inset) instead of Tree's
        // `position: absolute` default — a lower row's sheet would otherwise park itself off-screen (#330).
        <div style={{ position: "relative" }}>
          <KinList
            people={listPeople}
            onSelectPerson={setSelectedListPerson}
            viewerIsSteward={viewerIsSteward}
            onReconcile={openReconcile}
            highlightedPersonId={highlightedPersonId}
          />
          {selectedListPerson && (
            <PersonDetails
              key={selectedListPerson.personId}
              node={resolveListPersonNode(selectedListPerson, tree.nodes)}
              relationToViewer={selectedListPerson.relation}
              familyId={familyId}
              placement="viewport"
              onClose={() => setSelectedListPerson(null)}
              onSaved={() => router.refresh()}
              // #334 — the SAME in-place Invite modal Tree uses. `governableEdges` stays omitted (edge
              // governance is Tree-only, #283).
              onInvite={(node) => setListInviteNode(node)}
            />
          )}
          {listInviteNode && (
            <PersonInviteModal
              personId={listInviteNode.personId}
              fallbackName={listInviteNode.displayName}
              onClose={() => setListInviteNode(null)}
              fetchTargets={fetchInviteTargets}
              submitInvite={submitInvite}
            />
          )}
        </div>
      )}

      {reconcileStart ? (
        <ReconcileFlow
          familyId={familyId}
          start={reconcileStart}
          pool={reconcilePool}
          onClose={() => setReconcileStartId(null)}
          onSuccess={onReconcileSuccess}
        />
      ) : null}
    </div>
  );
}
