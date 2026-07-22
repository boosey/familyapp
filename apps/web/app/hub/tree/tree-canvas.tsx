"use client";
/**
 * TreeCanvas — the interactive ego-centric visual family tree (spec 2026-07-13; tree Slice A 2026-07-14).
 *
 * Owns the loaded `nodes`/`edges`, the `expansion` state, and the FOCUS person (the relation root). The
 * CAMERA (pan + zoom) is lifted to FamilyTab and passed in as controlled props (§5) — TreeCanvas keeps
 * `fit()`/`center()` (they need `layout.bounds` + the viewport ref) and exposes them via an imperative
 * handle. Renders an SVG connector layer with absolutely-positioned HTML node cards over it.
 *
 * §0 terminology — TWO things were both called "focus"; Slice A splits them:
 *   - FOCUS PERSON — the relation root. Relation chips (#9) + the sex ring (#8) are computed against it.
 *     The ONLY thing that changes it is the kebab Focus action (#2). Clicking/tapping/double-clicking a
 *     card NEVER changes it. Field: `focusPersonId` (now state, seeded from the prop).
 *   - CAMERA — pan + zoom. Its layout anchor is `cameraAnchor` and the centering fn is `centerCamera`
 *     (renamed from `focusPos`/`centerOnFocus`). Independent of the focus person after the first center.
 *
 * Interaction model (Slice A):
 *   - Single tap/click on a card = NO-OP (the panel is gone). A DOUBLE-click/double-tap opens the
 *     read-only <PersonDetails> sheet.
 *   - Pan by grabbing ANYWHERE, including cards (#3): a pointer that moves past DRAG_SLOP_PX pans,
 *     wherever it started. Cards no longer stop-propagate *move*; a card only intercepts a tap that did
 *     NOT become a drag (for double-tap detection). Carets & the kebab keep their own stopPropagation.
 *   - Per-direction CARETS expand/collapse a branch — CLIENT ONLY, off the fetch path.
 *   - A "+" opens the Add-a-relative MODAL (via TreeAddProvider); the per-card ⋮ opens the same modal.
   *   - Desktop tray → card-zone DnD (#287): while a tray place-drag is active, identified cards show
   *     top/bottom/side zones; drop opens PlaceConfirmModal (receiverLocked + relationFromZone). Canvas
   *     pan/zoom is unchanged when not dragging from the tray (drag source lives outside the pan layer).
   *   - Compact Place→tap→zone (#288): placeSubject selects a receiver with a single tap (anonymous
   *     bridges ignored); then the same CardDropZones overlay in tap mode reports relationFromZone.
   *   - The kebab Focus action re-roots the tree on that card (server refetch) and recomputes chips/ring,
   *     applying a PAN DELTA so the newly-focused card holds its on-screen position (camera visually still).
   *
 * Data loading (spec §7): the initial read is a bounded neighborhood; after each expansion a BACKGROUND
 * fetch tops the buffer up to one layer past the frontier. Best-effort, off the critical path.
 *
 * The layout function (./tree-layout) is pure and re-runs on every render from (nodes, edges, focus,
 * expansion).
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { hub } from "@/app/_copy";
import type {
  AddRelativeRelation,
  GovernableKinEdge,
  KinshipTreeData,
  ResolvedKinshipEdge,
  TreeNode,
  UnplacedMember,
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
import { PersonNode, isAnonymousBridge, displayNameFor } from "./person-node";
import {
  AFFORDANCE_SIZE_PX,
  DOUBLE_TAP_MS,
  DRAG_SLOP_PX,
  FIT_MARGIN,
  FIT_MAX_SCALE,
  NODE_H,
  NODE_W,
  ZOOM_MAX,
  ZOOM_MIN,
} from "./tree-constants";
import { PersonDetails } from "./person-details";
import { PersonInviteModal, type PersonInviteModalProps } from "./PersonInviteModal";
import { KebabMenu } from "./kebab-menu";
import { TreeInviteProvider } from "./invite-context";
import { edgeKey, mergeEdges, mergeNodes } from "./merge";
import { fetchSubtreeAction, type FetchSubtreeResult } from "./actions";
import { TreeAddProvider, type OpenAddRelative } from "./add-relative-context";
import { TreeFocusProvider } from "./focus-context";
import { LineGovernanceMenu } from "./line-governance-menu";
import { actableEdgesForHit } from "./line-governance";
import { AddRelativeModal } from "./add-relative-modal";
import { CardDropZones } from "./card-drop-zones";
import { PlaceConfirmModal } from "./place-confirm-modal";
import {
  getActivePlaceDrag,
  setActivePlaceDrag,
  subjectFromPlaceDrag,
  zoneDropModalProps,
} from "./place-drag";
import { useActivePlaceDrag } from "./use-active-place-drag";
import {
  relationFromZone,
  type PlaceConfirmSubject,
  type PlaceZone,
} from "./place-confirm";

/** Imperative controls FamilyTab drives from the (lifted-out) controls row. */
export interface TreeCanvasHandle {
  /** Zoom the whole loaded tree to fit the viewport and center its bounding box (§5). */
  fit: () => void;
}

export interface TreeCanvasProps {
  familyId: string;
  /** The INITIAL focus person (relation root, §1). Now re-rootable via the kebab Focus action (#2). */
  focusPersonId: string;
  /** The viewer's own personId — its card reads "You" and the details sheet shows relation-to-viewer. */
  viewerPersonId: string;
  initial: KinshipTreeData;
  /** Injected server action (spec §7). Defaults to the real fetchSubtreeAction; overridable in tests. */
  fetchSubtree?: (familyId: string, centerPersonId: string) => Promise<FetchSubtreeResult>;
  /**
   * CONTROLLED camera (§5) — lifted to FamilyTab so the Fit/−/+ controls can live in the selector row.
   * When omitted (e.g. a bare test mount), the canvas manages pan/scale internally. Zoom −/+ are simple
   * `setScale` calls FamilyTab owns directly; Fit/center stay here (they need `layout.bounds`).
   */
  scale?: number;
  onScaleChange?: (updater: (s: number) => number) => void;
  pan?: { x: number; y: number };
  onPanChange?: (updater: (p: { x: number; y: number }) => { x: number; y: number }) => void;
  /**
   * #251 — active members not yet on a kinship edge. Passed into AddRelativeModal so typing a
   * colliding name can offer connect-existing instead of minting a duplicate.
   */
  unplacedMembers?: readonly UnplacedMember[];
  /**
   * After a successful add/link, refresh server-rendered Family tab data (unplaced list, etc.).
   * FamilyTab passes `router.refresh()`. Optional so bare test mounts stay router-free.
   */
  onFamilyMutation?: () => void;
  /**
   * #254 — visible edges with stewardship/hide capability flags. Threaded into PersonDetails so
   * Remove/Hide are reachable from the tree (not the windowed `initial.edges`, which lack flags).
   */
  governableEdges?: readonly GovernableKinEdge[];
  /**
   * #288 — when set, a mobile Place→tap→zone session is active. Single-tap a person to show zones;
   * zone choice reports via {@link onPlaceZoneChosen}. Pan/zoom stay the canvas gestures (no
   * person-drag placement). Desktop DnD (#287) does not use this prop.
   */
  placeSubject?: PlaceConfirmSubject | null;
  /**
   * #288 — fired when the user taps a zone on a selected person during a canvas place session.
   */
  onPlaceZoneChosen?: (args: {
    receiverPersonId: string;
    receiverDisplayName: string;
    zone: PlaceZone;
    relation: AddRelativeRelation;
  }) => void;
  /**
   * #334 — overridable seams for the person-bound Invite modal (mirrors `fetchSubtree`'s injection
   * pattern above): default to the real server actions; tests inject fakes so opening/submitting the
   * modal never touches the real DB/auth context.
   */
  fetchInviteTargets?: PersonInviteModalProps["fetchTargets"];
  submitInvite?: PersonInviteModalProps["submitInvite"];
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

// Field separators for the content signature — control chars that never appear in names/ids, so a
// value can't be mistaken for a delimiter.
const SIG_FIELD = "␟";
const SIG_ITEM = "␞";
const SIG_SECTION = "␝";

/**
 * A stable, order-independent content signature of a tree payload: every node's id + rendered mutable
 * fields, plus the set of normalized edge keys. Two `initial` props with the same signature carry the
 * same data. It gates the same-family reconcile effect (#161): `initial` gets a new object identity on
 * every render, so without this gate `mergeNodes`' fresh array would drive an endless setState loop —
 * with it, the merge fires only when a mutation actually changed the server data. `relationToRoot` is
 * intentionally excluded: `mergeNodes` freezes it for already-seen nodes, so it can never change on a
 * merge, and it only shifts on a re-root (handled by the focus effect, not here).
 */
function treeContentSignature(data: KinshipTreeData): string {
  const nodes = data.nodes
    .map((n) =>
      [
        n.personId,
        n.displayName ?? "",
        n.identified ? 1 : 0,
        n.sex,
        n.lifeStatus,
        n.birthYear ?? "",
        n.deathYear ?? "",
        n.hasHiddenParents ? 1 : 0,
        n.hasHiddenChildren ? 1 : 0,
        n.inviteStatus,
      ].join(SIG_FIELD),
    )
    .sort()
    .join(SIG_ITEM);
  const edges = data.edges.map(edgeKey).sort().join(SIG_ITEM);
  return `${nodes}${SIG_SECTION}${edges}`;
}

// Drag/zoom/fit knobs live in ./tree-constants (imported above).

const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

interface AddTarget {
  anchorPersonId: string;
  relation: AddRelativeRelation;
  /** For a couple's child add: the OTHER partner, pre-bound so the click predetermines both parents. */
  coParentPersonId?: string;
}

/** #287 — PlaceConfirmModal opened from a tray → zone drop (locked receiver + zone relation). */
interface ZonePlaceTarget {
  subject: PlaceConfirmSubject;
  receiver: { personId: string; displayName: string };
  initialRelation: AddRelativeRelation;
}

export const TreeCanvas = forwardRef<TreeCanvasHandle, TreeCanvasProps>(function TreeCanvas(
  {
    familyId,
    focusPersonId: initialFocusPersonId,
    viewerPersonId,
    initial,
    fetchSubtree = fetchSubtreeAction,
    scale: scaleProp,
    onScaleChange,
    pan: panProp,
    onPanChange,
    unplacedMembers = [],
    onFamilyMutation,
    governableEdges = [],
    placeSubject = null,
    onPlaceZoneChosen,
    fetchInviteTargets,
    submitInvite,
  }: TreeCanvasProps,
  ref,
) {
  const [nodes, setNodes] = useState<TreeNode[]>(initial.nodes);
  const [edges, setEdges] = useState<ResolvedKinshipEdge[]>(initial.edges);
  const [expansion, setExpansion] = useState<ExpansionState>(EMPTY_EXPANSION);
  // The FOCUS person (relation root) — seeded from the prop, re-rooted only by the kebab Focus action.
  const [focusPersonId, setFocusPersonId] = useState(initialFocusPersonId);
  // #288 — person selected for zone pick during a mobile Place session (not the focus person).
  const [placeReceiverId, setPlaceReceiverId] = useState<string | null>(null);
  const placingOnCanvas = placeSubject != null;

  // Clear the zone target when the parent cancels / completes the place session.
  useEffect(() => {
    if (!placingOnCanvas) setPlaceReceiverId(null);
  }, [placingOnCanvas]);

  // Camera state. CONTROLLED when the parent passes pan/scale (§5 — FamilyTab owns them for the
  // lifted-out controls row); otherwise managed internally (bare test mounts). The `pan`/`scale` values
  // and `setPan`/`setScale` updaters below resolve to whichever source is active, transparently.
  const [panInternal, setPanInternal] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [scaleInternal, setScaleInternal] = useState(1);
  const pan = panProp ?? panInternal;
  const scale = scaleProp ?? scaleInternal;
  const setPan = useCallback(
    (updater: (p: { x: number; y: number }) => { x: number; y: number }) =>
      onPanChange ? onPanChange(updater) : setPanInternal(updater),
    [onPanChange],
  );
  const setScale = useCallback(
    (updater: (s: number) => number) => (onScaleChange ? onScaleChange(updater) : setScaleInternal(updater)),
    [onScaleChange],
  );

  // The open details sheet, or null. `startInEdit` (#5) requests the sheet open directly in edit mode
  // for an UNKNOWN card (unidentified / nameless); the sheet only honors it when the server says the
  // viewer may edit — otherwise it falls back to the read-only view.
  const [details, setDetails] = useState<{ id: string; startInEdit: boolean } | null>(null);
  // #334 — the person-bound Invite modal target, or null. A sibling overlay of `details`, not a
  // replacement for it: both can be mounted at once, so the details sheet stays open under the modal
  // and after a successful send (AC 4).
  const [inviteNode, setInviteNode] = useState<TreeNode | null>(null);
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);
  /** #289 — actable edges opened from a line hit-target. */
  const [lineGovEdges, setLineGovEdges] = useState<GovernableKinEdge[] | null>(null);
  /** #287 — confirm modal after tray → zone drop. */
  const [zonePlace, setZonePlace] = useState<ZonePlaceTarget | null>(null);
  const activePlaceDrag = useActivePlaceDrag();

  // Track which frontier centers we've already background-fetched, so top-up never re-fetches the same
  // node twice (idempotent, quiet, off the critical path).
  const toppedUp = useRef<Set<string>>(new Set());

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; panning: boolean } | null>(
    null,
  );
  // Double-tap detection: a card records its down; on up (if it wasn't a drag) we compare against the
  // last completed tap on the SAME card. `didDragRef` marks that a card-started pointer became a pan.
  const tapRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const lastTapRef = useRef<{ id: string; t: number } | null>(null);
  const didDragRef = useRef(false);
  // Whether the last completed card-pointer sequence was a drag — suppresses a following native dblclick.
  const lastWasDragRef = useRef(false);

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

  // The CAMERA ANCHOR: the focus person's position in layout space (renamed from `focusPos`, §0). The
  // layout re-normalizes its origin on every expansion (the tightest box starts at 0), so a node's
  // absolute (x,y) shifts by a whole generation-step when kin appear above/below. We make the focus the
  // camera origin (below) so those shifts cancel out and an expand/collapse never yanks the viewport.
  // Falls back to (0,0) if the focus somehow isn't drawn.
  const cameraAnchor = useMemo(() => {
    const f = layout.placed.find((p) => p.personId === focusPersonId);
    return f ? { x: f.x, y: f.y } : { x: 0, y: 0 };
  }, [layout, focusPersonId]);

  // Relation of each person to the VIEWER, derived from the loaded edges (the tree is focus-rooted, so
  // node.relationToRoot is relation-to-focus and can't be used for the details sheet). Empty when the
  // viewer isn't reachable in the loaded projection (distant focus) — the sheet then omits the relation.
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
   * Center the CAMERA on the focus at 1× (the default framing; renamed from `centerOnFocus`, §0).
   * `pan` is the focus's on-screen offset from the pan-layer origin (horizontal-center / top of the
   * viewport), so centering horizontally is x:0 and the focus rides at the vertical middle. The focus's
   * layout coordinates are absorbed by the transform (the pan-layer), keeping an expansion from moving it.
   */
  const centerCamera = useCallback(() => {
    const vh = viewportRef.current?.clientHeight ?? 480;
    setScale(() => 1);
    setPan(() => ({ x: 0, y: vh * 0.5 }));
  }, [setScale, setPan]);

  // The pan-layer transform is `translate(pan) · scale(s) · translate(-anchor)` with origin 0,0, so a
  // layout point p lands at screen (vw/2 + pan.x + s·(p.x−anchor.x), pan.y + s·(p.y−anchor.y)). `Fit`
  // ZOOMS the whole loaded tree to fit the viewport and centers its bounding box.
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
    setScale(() => s);
    setPan(() => ({
      x: -s * (bw / 2 - cameraAnchor.x),
      y: vh / 2 - s * (bh / 2 - cameraAnchor.y),
    }));
  }, [layout.bounds.width, layout.bounds.height, cameraAnchor.x, cameraAnchor.y, setScale, setPan]);

  // Expose Fit to FamilyTab's (lifted-out) controls row (§5).
  useImperativeHandle(ref, () => ({ fit: fitToView }), [fitToView]);

  // Center the camera on the focus ONCE, at first paint. Never on expansion or re-focus (§1) — those
  // would yank the viewport.
  useEffect(() => {
    centerCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile the `initial` prop after mount — two regimes, keyed on whether the FAMILY changed. Both
  // adjust state DURING RENDER (React's "store previous prop, setState during render" pattern), so React
  // discards the stale render and re-renders with the corrected state before painting — no flash.
  //
  //   • Family SWITCH (#141) — full RESET. The canvas seeds nodes/edges/expansion/focus from props on
  //     MOUNT only; switching families via the chip bar hands NEW `familyId` + `initial` to the SAME
  //     mounted component, so without this the previous family's tree persisted until a List<->Tree
  //     toggle forced a remount (the "fix" users found). We reload from the new props + re-seed focus
  //     here, and (in the effect below) clear the top-up dedupe set + re-center — none of the old
  //     family's in-session state is meaningful for the new one.
  //
  //   • SAME family, fresh data (#161) — MERGE. A mutation (place an unplaced member, add a relative,
  //     edit a person) revalidates /hub and `router.refresh()` hands a fresh same-family `initial`. We
  //     merge it into current state (additive + incoming-wins via mergeNodes/mergeEdges) so the new/
  //     edited node shows WITHOUT a manual reload, while preserving in-session expansion/focus/camera:
  //     the loaded set is a SUPERSET of the bounded `initial` window, and merge never prunes it.
  //
  // The merge is gated on a CONTENT signature (not `initial`'s per-render object identity), so it fires
  // only when the server data actually changed — otherwise mergeNodes' fresh array would loop setState.
  const [prevFamilyId, setPrevFamilyId] = useState(familyId);
  const [prevInitialSig, setPrevInitialSig] = useState<string | null>(null);
  // Memoized so it recomputes only when `initial` changes identity — not on every hot pan/zoom frame
  // (those re-render with the SAME `initial` reference).
  const initialSig = useMemo(() => treeContentSignature(initial), [initial]);
  if (familyId !== prevFamilyId) {
    setPrevFamilyId(familyId);
    setPrevInitialSig(initialSig);
    setNodes(initial.nodes);
    setEdges(initial.edges);
    setExpansion(EMPTY_EXPANSION);
    setFocusPersonId(initialFocusPersonId);
  } else if (prevInitialSig === null) {
    // First render after mount: record the mounted signature (state already came from useState(initial)).
    setPrevInitialSig(initialSig);
  } else if (prevInitialSig !== initialSig) {
    setPrevInitialSig(initialSig);
    setNodes((prev) => mergeNodes(prev, initial.nodes));
    setEdges((prev) => mergeEdges(prev, initial.edges));
  }

  // Camera centering reads DOM refs (viewportRef.current?.clientHeight) and may update parent-controlled
  // state, so it is a genuine side effect and stays in a useEffect, guarded by a ref. Only a FAMILY
  // switch clears the top-up dedupe set + re-centers; a same-family merge leaves the camera untouched.
  const prevFamilyIdRef = useRef(familyId);
  useEffect(() => {
    if (prevFamilyIdRef.current !== familyId) {
      prevFamilyIdRef.current = familyId;
      toppedUp.current = new Set();
      centerCamera();
    }
  }, [familyId, centerCamera]);

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
    // Re-run when the drawn frontier changes, OR when the family switches (#141). Listing `familyId`
    // means a family change ALWAYS tears down this effect (its cleanup sets `cancelled`), so an
    // in-flight top-up fetch closed over the OLD family can never merge stale nodes into the freshly
    // switched tree — even in the corner case where the two families' placed-node counts coincide and
    // neither `layout.placed.length` nor `nodes.length` changes value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.placed.length, nodes.length, familyId]);

  // --- Focus (re-root) with pan-delta so the camera holds still (§1/§3) --------------------------
  // The kebab Focus action re-roots the tree on `personId`: refetch that subtree (server re-root),
  // set `focusPersonId`, and recompute chips + ring (they derive from the focus). The camera must NOT
  // move (§1). After re-focus the new focus becomes the camera ANCHOR, so its post-refocus screen
  // position is `base + pan`. Its screen position AT CLICK TIME is `base + pan + s·(p_old − anchor_old)`.
  // Equating the two ⇒ nudge pan by `s·(p_old − anchor_old)` — the on-screen offset of the clicked card
  // from the current anchor. (p_old and anchor_old are read from the CURRENT layout, pre-refocus.)
  const onFocus = useCallback(
    (personId: string) => {
      if (personId === focusPersonId) return;
      const placed = layout.placed.find((p) => p.personId === personId);
      if (placed) {
        const dx = scale * (placed.x - cameraAnchor.x);
        const dy = scale * (placed.y - cameraAnchor.y);
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      }
      setFocusPersonId(personId);
      // Server RE-ROOT: refetch a projection rooted on the new focus and REPLACE the node/edge set with
      // it. We replace (not merge) because `mergeNodes` deliberately FREEZES `relationToRoot` to the
      // original root's value for already-seen nodes (it's built for boundary top-up, not re-rooting) —
      // so a merge would leave the chips labeled relative to the OLD focus. A fresh replace makes every
      // chip read relative to the new focus, which is the whole point of Focus (#9). The top-up dedupe
      // set is cleared so the new frontier can be topped up afresh. The ring already moved client-side.
      toppedUp.current = new Set();
      void (async () => {
        try {
          const res = await fetchSubtree(familyId, personId);
          if (res.ok) {
            setNodes(() => res.data.nodes);
            setEdges(() => res.data.edges);
          }
        } catch {
          /* best-effort — the ring already moved; a refresh reconciles the chips. */
        }
      })();
    },
    [focusPersonId, layout.placed, scale, cameraAnchor.x, cameraAnchor.y, setPan, familyId, fetchSubtree],
  );

  // --- Add-a-relative (modal over the tree, spec 2026-07-14) -------------------------------------
  // The "+" gutter buttons and the per-card ⋮ menu open ONE Add modal now (/hub/kin is gone).
  // `openAdd` is shared with those child components via TreeAddProvider.
  const openAdd: OpenAddRelative = useCallback((anchorPersonId, relation, coParentPersonId) => {
    setAddTarget({ anchorPersonId, relation, coParentPersonId });
  }, []);

  // --- Invite (#334, ADR-0028) -------------------------------------------------------------------
  // ONE handler backing BOTH entry points (the details-sheet button and the kebab item, #5) — it opens
  // the IN-PLACE PersonInviteModal (below) instead of navigating away to `/hub?tab=invite` (#334
  // retires that deep-link). The modal fetches its own server-prepared targets from `personId`.
  const onInvite = useCallback((node: TreeNode) => {
    setInviteNode(node);
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

  // The anchor's partners (for the modal's co-parent checkboxes) — the OTHER endpoint of every
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

  // The anchor's children (for the partner→kids step offer) — personB of every parent_of from anchor.
  const childrenOf = useCallback(
    (anchorId: string): { id: string; name: string }[] => {
      const out: { id: string; name: string }[] = [];
      for (const e of edges) {
        if (e.edgeType !== "parent_of" || e.personAId !== anchorId) continue;
        const n = nodeById.get(e.personBId);
        out.push({
          id: e.personBId,
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

  // --- Drag-to-pan (from ANYWHERE, including cards — §3) -----------------------------------------
  // The viewport's pointer handlers own the pan. Cards no longer stop-propagate *move*, so a pointer
  // that starts on a card still pans the canvas (its pointerdown BUBBLES to the viewport, which sets
  // `dragRef`). Carets & the kebab keep their own stopPropagation, so they are never swallowed by a pan.
  const onPointerDown = (e: React.PointerEvent) => {
    // Record the gesture origin but do NOT capture the pointer yet. Capturing on pointerdown routes
    // every later pointer event (incl. pointerup) to the viewport, so cards never see their own
    // pointerup — which silently breaks double-tap detection on real browsers (jsdom dispatches
    // events directly to a node, so tests wouldn't catch it). We defer capture until an actual pan.
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, panning: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    // Below the slop the gesture may still be a tap/double-tap, which must reach the card handlers —
    // so only once movement crosses DRAG_SLOP_PX do we commit to a pan and capture the pointer.
    if (!d.panning && Math.hypot(dx, dy) > DRAG_SLOP_PX) {
      d.panning = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (d.panning) setPan(() => ({ x: d.panX + dx, y: d.panY + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.panning) (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // --- Card tap / double-tap → read-only details sheet (§2, display half of #4) ------------------
  // A single tap is a NO-OP now (the panel is gone). A DOUBLE tap on the SAME card within DOUBLE_TAP_MS,
  // both within the drag slop (no pan between them), opens the details sheet. The card does NOT
  // stop-propagate pointerdown/move (so a drag started on it still pans); it only records tap geometry.
  const onNodePointerDown = (id: string, e: React.PointerEvent) => {
    tapRef.current = { id, x: e.clientX, y: e.clientY };
    didDragRef.current = false;
  };
  const onNodePointerMove = (_id: string, e: React.PointerEvent) => {
    const t = tapRef.current;
    if (!t) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > DRAG_SLOP_PX) didDragRef.current = true;
  };
  const onNodePointerUp = (id: string, e: React.PointerEvent) => {
    const t = tapRef.current;
    tapRef.current = null;
    const wasDrag = didDragRef.current;
    // Remember whether THIS pointer sequence was a drag, so a native dblclick that follows a drag is
    // suppressed (a drag should never open details, even via the mouse dblclick path).
    lastWasDragRef.current = wasDrag;
    didDragRef.current = false;
    // A drag (this pointer moved past the slop) is a pan, never a tap — and it cancels any pending
    // double-tap so a drag between two taps doesn't complete one.
    if (!t || t.id !== id || wasDrag) {
      lastTapRef.current = null;
      return;
    }
    // #288 — during Place→tap→zone, a single tap selects the receiver (zones appear). Details
    // double-tap is suppressed for the session; pan/zoom remain the canvas gestures above.
    // Anonymous bridges are inert (#312 parity) — never become place receivers.
    if (placingOnCanvas) {
      lastTapRef.current = null;
      const n = nodeById.get(id);
      if (!n || isAnonymousBridge(n)) return;
      setDetails(null);
      setLineGovEdges(null);
      setPlaceReceiverId(id);
      return;
    }
    const now = e.timeStamp;
    const last = lastTapRef.current;
    if (last && last.id === id && now - last.t <= DOUBLE_TAP_MS) {
      lastTapRef.current = null;
      openDetails(id);
    } else {
      lastTapRef.current = { id, t: now };
    }
  };
  // Native double-click (mouse / keyboard-driven) also opens the sheet — a11y + non-pointer paths.
  // Suppressed when the immediately-preceding pointer sequence was a drag (a pan, not a tap).
  const onNodeDoubleClick = (id: string) => {
    if (placingOnCanvas) return;
    if (lastWasDragRef.current) {
      lastWasDragRef.current = false;
      return;
    }
    openDetails(id);
  };

  // Open the details sheet for `id`. #5: an UNKNOWN card (no usable name — an anonymous bridge OR an
  // identified-but-nameless person) requests edit mode up front; the sheet gates that on the
  // server-projected `editable` flag.
  const openDetails = (id: string) => {
    const n = nodeById.get(id);
    const nameless = !n || n.displayName == null || n.displayName.trim().length === 0;
    setLineGovEdges(null);
    setDetails({ id, startInEdit: nameless });
  };

  const detailsNode = details ? (nodeById.get(details.id) ?? null) : null;

  return (
    <TreeFocusProvider value={onFocus}>
    <TreeInviteProvider value={onInvite}>
    <TreeAddProvider value={openAdd}>
    <div style={{ position: "relative" }}>
      {/* The Fit/−/+ controls moved OUT of the canvas into FamilyTab's view-selector row (§5). */}

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
            // Anchor the camera on the focus person: `translate(pan) · scale · translate(-anchor)`
            // (origin 0,0) makes the focus the fixed origin — re-normalization on expand/collapse (which
            // shifts every node's coords by a generation-step) leaves the focus visually stationary, and
            // a scale change zooms ABOUT the focus. On re-focus the anchor jumps to the new focus and a
            // pan-delta (see onFocus) cancels the jump so the camera holds still.
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale}) translate(${-cameraAnchor.x}px, ${-cameraAnchor.y}px)`,
            transformOrigin: "0 0",
            width: layout.bounds.width,
            height: layout.bounds.height,
          }}
        >
          {/* Connector layer (SVG, behind node cards). Visual strokes stay pointer-events:none;
              #289 hit-targets are a separate stroke layer with fat invisible paths. */}
          <svg
            width={layout.bounds.width}
            height={layout.bounds.height}
            viewBox={`0 0 ${layout.bounds.width} ${layout.bounds.height}`}
            style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
          >
            {/* Only descent buses are drawn — same-row cards (partners, siblings) are never joined by a
                direct line; a partnership reads from proximity and connects down through this bus. The
                U / inverted-U corners are rounded at paint time (the layout emits exact polylines). */}
            <g style={{ pointerEvents: "none" }}>
              {layout.connectors.map((c, i) => (
                <path
                  key={`viz-${i}`}
                  d={roundedPath(c.d, 8)}
                  fill="none"
                  stroke="var(--border-strong)"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
            </g>
            {/* #289 — fat invisible hit strokes for stored parent_of / partnered_with only. */}
            <g>
              {layout.edgeHits.map((hit, i) => (
                <path
                  key={`hit-${i}`}
                  d={hit.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ cursor: "pointer", pointerEvents: "stroke" }}
                  data-testid="tree-edge-hit"
                  role="button"
                  tabIndex={0}
                  aria-label={hub.tree.lineGovernHit}
                  onPointerDown={(e) => {
                    // Keep the canvas from treating this as a pan start.
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const actable = actableEdgesForHit(governableEdges, hit.edgeRefs);
                    if (actable.length === 0) {
                      setLineGovEdges(null);
                      return;
                    }
                    setDetails(null);
                    setLineGovEdges(actable);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    e.stopPropagation();
                    const actable = actableEdgesForHit(governableEdges, hit.edgeRefs);
                    if (actable.length === 0) return;
                    setDetails(null);
                    setLineGovEdges(actable);
                  }}
                />
              ))}
            </g>
          </svg>

          {/* Node cards. Identified cards carry a per-card ⋮; anonymous bridges are inert. */}
          {layout.placed.map((p) => {
            const c = countsFor(p.personId);
            const inert = isAnonymousBridge(p.node);
            const isFocus = p.personId === focusPersonId;
            const isViewer = p.personId === viewerPersonId;
            const showZones = !inert && placingOnCanvas && placeReceiverId === p.personId;
            return (
              <div
                key={p.personId}
                data-testid={`tree-node-pos-${p.personId}`}
                onPointerDown={(e) => onNodePointerDown(p.personId, e)}
                onPointerMove={(e) => onNodePointerMove(p.personId, e)}
                onPointerUp={(e) => onNodePointerUp(p.personId, e)}
                onDoubleClick={() => onNodeDoubleClick(p.personId)}
                style={{ position: "absolute", left: p.x - NODE_W / 2, top: p.y - NODE_H / 2 }}
              >
                <PersonNode
                  node={p.node}
                  focus={isFocus}
                  isViewer={isViewer}
                  squareCorner={squareCornerByPerson.get(p.personId)}
                  kebab={
                    inert || placingOnCanvas ? undefined : (
                      <KebabMenu
                        node={p.node}
                        parentCount={c.parents}
                        partnerCount={c.partners}
                        isFocus={isFocus}
                      />
                    )
                  }
                />
                {/* #287 drop / #288 tap — same CardDropZones + relationFromZone; never on inert bridges. */}
                {!inert && activePlaceDrag ? (
                  <CardDropZones
                    personId={p.personId}
                    mode="drop"
                    active
                    onZoneDrop={(zone) => {
                      const payload = getActivePlaceDrag() ?? activePlaceDrag;
                      setActivePlaceDrag(null);
                      const props = zoneDropModalProps(
                        zone,
                        {
                          personId: p.personId,
                          displayName: displayNameFor(p.node),
                        },
                        subjectFromPlaceDrag(payload),
                      );
                      setDetails(null);
                      setAddTarget(null);
                      setZonePlace({
                        subject: props.subject,
                        receiver: props.receiver,
                        initialRelation: props.initialRelation,
                      });
                    }}
                  />
                ) : showZones ? (
                  <CardDropZones
                    personId={p.personId}
                    mode="tap"
                    onZoneChoose={(zone) => {
                      onPlaceZoneChosen?.({
                        receiverPersonId: p.personId,
                        receiverDisplayName: displayNameFor(p.node),
                        zone,
                        relation: relationFromZone(zone),
                      });
                    }}
                  />
                ) : null}
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

      {lineGovEdges && lineGovEdges.length > 0 && (
        <LineGovernanceMenu
          familyId={familyId}
          edges={lineGovEdges}
          onClose={() => setLineGovEdges(null)}
          onEdgeGoverned={(edge, kind) => {
            if (kind === "deny" || kind === "hide") {
              const key = `${edge.edgeType}:${edge.personAId}:${edge.personBId}`;
              setEdges((prev) => prev.filter((e) => edgeKey(e) !== key));
            }
            onFamilyMutation?.();
          }}
        />
      )}

      {detailsNode && details && (
        <PersonDetails
          // Key on the person so switching cards (double-click another while the sheet is open)
          // remounts the sheet + its edit form with fresh state, instead of leaking the previous
          // person's in-progress edits (displayName/birthYear/sex/…) onto the new one.
          key={detailsNode.personId}
          node={detailsNode}
          relationToViewer={viewerRelation.get(detailsNode.personId) ?? null}
          familyId={familyId}
          startInEdit={details.startInEdit}
          onClose={() => setDetails(null)}
          onSaved={(personId) => void refetchAnchor(personId)}
          onInvite={onInvite}
          governableEdges={governableEdges}
          onEdgeGoverned={(edge, kind) => {
            // Same-family merge is additive — a denied/hidden edge would otherwise linger in client
            // state after router.refresh(). Drop it locally for deny/hide only; affirm/correct must
            // keep the edge (content signature ignores state/nature, so a pruned edge would not come
            // back after Endorse or Update nature).
            if (kind === "deny" || kind === "hide") {
              const key = `${edge.edgeType}:${edge.personAId}:${edge.personBId}`;
              setEdges((prev) => prev.filter((e) => edgeKey(e) !== key));
            }
            onFamilyMutation?.();
          }}
        />
      )}

      {addTarget && (
        <AddRelativeModal
          familyId={familyId}
          anchorPersonId={addTarget.anchorPersonId}
          initialRelation={addTarget.relation}
          coParentOptions={partnersOf(addTarget.anchorPersonId)}
          preselectedCoParentId={addTarget.coParentPersonId}
          childOptions={childrenOf(addTarget.anchorPersonId)}
          unplacedMembers={unplacedMembers}
          onClose={() => setAddTarget(null)}
          onSuccess={() => {
            const anchor = addTarget.anchorPersonId;
            setAddTarget(null);
            void refetchAnchor(anchor);
            onFamilyMutation?.();
          }}
        />
      )}

      {inviteNode && (
        <PersonInviteModal
          personId={inviteNode.personId}
          fallbackName={inviteNode.displayName}
          onClose={() => setInviteNode(null)}
          fetchTargets={fetchInviteTargets}
          submitInvite={submitInvite}
        />
      )}

      {zonePlace && (
        <PlaceConfirmModal
          familyId={familyId}
          subject={zonePlace.subject}
          receiver={zonePlace.receiver}
          receiverLocked
          initialRelation={zonePlace.initialRelation}
          onClose={() => setZonePlace(null)}
          onSuccess={() => {
            const anchor = zonePlace.receiver.personId;
            setZonePlace(null);
            void refetchAnchor(anchor);
            onFamilyMutation?.();
          }}
        />
      )}
    </div>
    </TreeAddProvider>
    </TreeInviteProvider>
    </TreeFocusProvider>
  );
});

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
