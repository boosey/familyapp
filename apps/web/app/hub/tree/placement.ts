/**
 * Typed Placement write seam (#318 / ADR-0027).
 *
 * Tray / tap-zone / kebab (and later invite) adapters build a {@link Placement} and call
 * {@link commitPlacement}. FormData is NOT the real mint seam — HTML forms may marshal into
 * Placement, but mint/link writes go through this typed interface into core kinship writes.
 *
 * Partner→children offer orchestration lives here once ({@link resolvePartnerChildrenOffer}) so
 * confirm UIs do not duplicate ADR-0027 offer-never-silent gating.
 */
import type { AddRelativeInput, AddRelativeRelation } from "@chronicle/core";
import type { InviteRelationship, KinshipNature, PersonSex } from "@chronicle/db";

/** Card drop / tap zones (ADR-0027). No sibling zone — sibling is child-on-parent or Add sibling. */
export type PlaceZone = "top" | "bottom" | "side";

/** Map a zone choice to the pre-filled place-confirm relation. */
export function relationFromZone(zone: PlaceZone): AddRelativeRelation {
  switch (zone) {
    case "top":
      return "parent";
    case "bottom":
      return "child";
    case "side":
      return "partner";
  }
}

export type PlacementWriteOpts = {
  coParentPersonIds?: string[];
  /**
   * Partner→kids (ADR-0027). When the receiver has children and relation is partner, this MUST be
   * an explicit array before commit — `[]` = declined (partner only), non-empty = step parent-of.
   * `undefined` with kids present fails offer-never-silent validation.
   */
  stepParentOfChildIds?: string[];
  nature?: KinshipNature;
};

export type LinkPlacement = {
  kind: "link";
  familyId: string;
  existingPersonId: string;
  relation: AddRelativeRelation;
  /** Receiver = person on the tree the subject relates to (anchor). */
  receiverPersonId: string;
} & PlacementWriteOpts;

export type MintPlacement = {
  kind: "mint";
  familyId: string;
  relation: AddRelativeRelation;
  receiverPersonId: string;
  displayName?: string;
  birthDate?: string;
  lifeStatus?: "living" | "deceased";
  deathYear?: number;
  sex?: PersonSex;
} & PlacementWriteOpts;

/**
 * Shaped for a later invite adapter — not executed by {@link commitPlacement} yet.
 * Carries the same relation/receiver/offer fields so invite can reuse offer-never-silent.
 */
export type InvitePlanPlacement = {
  kind: "invite-plan";
  familyId: string;
  relation: AddRelativeRelation;
  receiverPersonId: string;
  displayName?: string;
  contactHint?: string;
  inviteRelationship?: InviteRelationship;
} & PlacementWriteOpts;

export type Placement = LinkPlacement | MintPlacement | InvitePlanPlacement;

export type PlacementResult = { ok: true } | { ok: false; error?: string };

export type PlacementDeps = {
  onLink?: (placement: LinkPlacement) => Promise<PlacementResult>;
  onMint?: (placement: MintPlacement) => Promise<PlacementResult>;
  /** Optional later invite adapter; default rejects as not implemented. */
  onInvitePlan?: (placement: InvitePlanPlacement) => Promise<PlacementResult>;
};

/** ADR-0027: partner with existing kids requires an explicit offer resolution before write. */
export function partnerChildrenOfferRequired(
  relation: AddRelativeRelation,
  anchorChildCount: number,
): boolean {
  return relation === "partner" && anchorChildCount > 0;
}

/**
 * Shared partner→children offer orchestration (offer-never-silent).
 * Both confirm UIs call this instead of duplicating prompt/resolve logic.
 *
 * - When offer is not needed → proceed (no step ids).
 * - When needed and `pendingSelection` is null → show offer (seed all kids checked).
 * - When needed and selection is a Set → proceed with that explicit list (possibly empty = decline).
 */
export function resolvePartnerChildrenOffer(args: {
  relation: AddRelativeRelation;
  children: readonly { id: string }[];
  /** null = not yet on the offer step; Set = user resolved (subset may be empty). */
  pendingSelection: ReadonlySet<string> | null;
}):
  | { type: "show-offer"; initialSelection: Set<string> }
  | { type: "ready"; stepParentOfChildIds: string[] | undefined } {
  if (!partnerChildrenOfferRequired(args.relation, args.children.length)) {
    return { type: "ready", stepParentOfChildIds: undefined };
  }
  if (args.pendingSelection === null) {
    return {
      type: "show-offer",
      initialSelection: new Set(args.children.map((c) => c.id)),
    };
  }
  // Explicit array — empty means declined. Never omit when kids exist.
  return { type: "ready", stepParentOfChildIds: [...args.pendingSelection] };
}

/**
 * Validate ADR-0027 offer-never-silent on a Placement about to be committed.
 * When partner + kids exist, `stepParentOfChildIds` must be defined (array, possibly empty).
 */
export function assertPartnerChildrenOfferResolved(
  placement: Pick<Placement, "relation" | "stepParentOfChildIds">,
  anchorChildIds: readonly string[],
): { ok: true } | { ok: false; error: "offer-unresolved" } {
  if (!partnerChildrenOfferRequired(placement.relation, anchorChildIds.length)) {
    return { ok: true };
  }
  if (placement.stepParentOfChildIds === undefined) {
    return { ok: false, error: "offer-unresolved" };
  }
  return { ok: true };
}

/** Marshal a mint Placement into core's typed {@link AddRelativeInput} (no FormData). */
export function mintPlacementToAddRelativeInput(placement: MintPlacement): AddRelativeInput {
  const coParents = placement.coParentPersonIds ?? [];
  const uniqueCoParents = [...new Set(coParents.filter((id) => typeof id === "string" && id.trim()))];
  const stepKids =
    placement.relation === "partner" && placement.stepParentOfChildIds
      ? [...new Set(placement.stepParentOfChildIds.filter((id) => typeof id === "string" && id.trim()))]
      : [];
  const trimmedName = placement.displayName?.trim() ?? "";
  const nature =
    (placement.relation === "parent" || placement.relation === "child") && placement.nature
      ? placement.nature
      : undefined;

  return {
    familyId: placement.familyId,
    relation: placement.relation,
    ...(placement.receiverPersonId ? { anchorPersonId: placement.receiverPersonId } : {}),
    ...(trimmedName ? { displayName: trimmedName } : {}),
    ...(placement.birthDate?.trim() ? { birthDate: placement.birthDate.trim() } : {}),
    ...(placement.lifeStatus ? { lifeStatus: placement.lifeStatus } : {}),
    ...(placement.lifeStatus === "deceased" && placement.deathYear !== undefined
      ? { deathYear: placement.deathYear }
      : {}),
    ...(placement.sex && placement.sex !== "unknown" ? { sex: placement.sex } : {}),
    ...(nature ? { nature } : {}),
    ...(uniqueCoParents.length === 1 ? { coParentPersonId: uniqueCoParents[0] } : {}),
    ...(uniqueCoParents.length > 0 ? { coParentPersonIds: uniqueCoParents } : {}),
    ...(stepKids.length > 0 ? { stepParentOfChildIds: stepKids } : {}),
  };
}

/**
 * Commit a typed Placement through injected adapters (link / mint / invite-plan).
 * When `offerContext` is supplied, enforces offer-never-silent before any write.
 */
export async function commitPlacement(
  placement: Placement,
  deps: PlacementDeps = {},
  offerContext?: { anchorChildIds: readonly string[] },
): Promise<PlacementResult> {
  if (offerContext) {
    const check = assertPartnerChildrenOfferResolved(placement, offerContext.anchorChildIds);
    if (!check.ok) {
      return { ok: false, error: check.error };
    }
  }

  switch (placement.kind) {
    case "link": {
      const onLink = deps.onLink;
      if (!onLink) return { ok: false, error: "no-link-adapter" };
      return onLink(placement);
    }
    case "mint": {
      const onMint = deps.onMint;
      if (!onMint) return { ok: false, error: "no-mint-adapter" };
      return onMint(placement);
    }
    case "invite-plan": {
      const onInvitePlan = deps.onInvitePlan;
      if (!onInvitePlan) return { ok: false, error: "invite-plan-not-implemented" };
      return onInvitePlan(placement);
    }
  }
}
