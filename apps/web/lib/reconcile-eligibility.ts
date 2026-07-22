/**
 * #337 — Steward Reconciliation UI eligibility (pure).
 *
 * Product: from a person, offer **This is the same person as…** only when the complementary side
 * has ≥1 candidate (H+). Loser = identified tree-only `mention` (placeholders out). Winner =
 * active Member with Account. Core's `reconcileMentionIntoAccount` still re-checks steward + merge.
 */
export type ReconcileSide = "mention" | "member";

/** Person fields needed to decide reconcile start/candidate eligibility in one family. */
export interface ReconcilePersonView {
  personId: string;
  displayName: string | null;
  identified: boolean;
  /** Active membership in the selected family. */
  isActiveMember: boolean;
  /** `persons.accountId != null`. */
  hasAccount: boolean;
  /** `persons.origin === "mention"`. */
  isMention: boolean;
}

/**
 * Which side of a reconcile pair this person can occupy, or null if neither (e.g. placeholder,
 * account-less member, non-member non-mention).
 */
export function reconcileSideOf(p: ReconcilePersonView): ReconcileSide | null {
  // Loser: identified mention. Mentions never hold accounts; still require !hasAccount defensively.
  if (p.isMention && p.identified && !p.hasAccount) return "mention";
  // Winner: active member with an Account.
  if (p.isActiveMember && p.hasAccount) return "member";
  return null;
}

/** Complementary picker pool for `start` within `pool` (excludes start; never placeholders). */
export function complementaryCandidates(
  start: ReconcilePersonView,
  pool: readonly ReconcilePersonView[],
): ReconcilePersonView[] {
  const side = reconcileSideOf(start);
  if (side === null) return [];
  const want: ReconcileSide = side === "mention" ? "member" : "mention";
  return pool.filter(
    (p) => p.personId !== start.personId && reconcileSideOf(p) === want,
  );
}

/** Steward-only; hidden when the complementary picker would be empty (H+). */
export function canOfferReconcile(
  viewerIsSteward: boolean,
  start: ReconcilePersonView,
  pool: readonly ReconcilePersonView[],
): boolean {
  return viewerIsSteward && complementaryCandidates(start, pool).length > 0;
}

/** Map UI start + picked complementary → always mention (loser) + account (winner) for the API. */
export function reconcileApiIds(
  start: ReconcilePersonView,
  picked: ReconcilePersonView,
): { mentionPersonId: string; accountPersonId: string } | null {
  const startSide = reconcileSideOf(start);
  const pickedSide = reconcileSideOf(picked);
  if (startSide === null || pickedSide === null || startSide === pickedSide) return null;
  if (startSide === "mention") {
    return { mentionPersonId: start.personId, accountPersonId: picked.personId };
  }
  return { mentionPersonId: picked.personId, accountPersonId: start.personId };
}

/**
 * After a successful reconcile on Tree, push `?anchor=<winner>` only when it differs from the
 * current anchor (unchanged URL → Next may no-op a push). Callers must still `router.refresh()`
 * always so the mention leaves the projection even when the winner was already focused.
 */
export function shouldPushReconcileTreeAnchor(
  view: "tree" | "list",
  currentAnchor: string | null | undefined,
  accountPersonId: string,
): boolean {
  return view === "tree" && currentAnchor !== accountPersonId;
}
