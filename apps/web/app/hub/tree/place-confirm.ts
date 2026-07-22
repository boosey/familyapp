/**
 * Shared place-confirm seam (#286 / #318 / ADR-0027) — zone types, subject shapes, and thin
 * adapters over the typed {@link commitPlacement} write seam.
 *
 * Desktop DnD (#287) and mobile Place→tap (#288) open the same PlaceConfirmModal with
 * `receiverLocked: true` and `initialRelation` from {@link relationFromZone}.
 *
 * Mint no longer round-trips FormData as the real seam — {@link commitPlaceMint} builds a
 * {@link MintPlacement} and commits through typed adapters.
 */
import type { AddRelativeRelation } from "@chronicle/core";
import type { KinshipNature, PersonSex } from "@chronicle/db";
import { addRelativeTypedAction } from "../kin/actions";
import { linkExistingMemberAction } from "./actions";
import {
  commitPlacement,
  type LinkPlacement,
  type MintPlacement,
  type PlacementResult,
  relationFromZone,
  type PlaceZone,
} from "./placement";

export type { PlaceZone };
export { relationFromZone };
export {
  assertPartnerChildrenOfferResolved,
  commitPlacement,
  mintPlacementToAddRelativeInput,
  partnerChildrenOfferRequired,
  resolvePartnerChildrenOffer,
  type InvitePlanPlacement,
  type LinkPlacement,
  type MintPlacement,
  type Placement,
  type PlacementDeps,
  type PlacementResult,
} from "./placement";

export type PlaceConfirmSubject =
  | {
      kind: "link";
      personId: string;
      displayName: string | null;
    }
  | {
      kind: "mint";
      /** Optional seed for the new-person name field (usually blank from the tray). */
      initialDisplayName?: string;
    };

export type PlaceConfirmWriteOpts = {
  coParentPersonIds?: string[];
  stepParentOfChildIds?: string[];
  nature?: KinshipNature;
  /**
   * When provided (partner confirm UIs), enforces ADR-0027 offer-never-silent on commit:
   * partner + kids requires an explicit `stepParentOfChildIds` array (possibly empty = decline).
   */
  anchorChildIds?: string[];
};

export type PlaceConfirmLinkDeps = {
  onLink?: (
    familyId: string,
    existingPersonId: string,
    relation: AddRelativeRelation,
    receiverPersonId: string,
    coParentPersonId?: string,
    opts?: PlaceConfirmWriteOpts,
  ) => Promise<{ ok: boolean }>;
};

export type PlaceConfirmMintDeps = {
  /** Typed mint adapter — receives {@link MintPlacement}, not FormData. */
  onMint?: (placement: MintPlacement) => Promise<PlacementResult>;
};

/**
 * Link an existing unplaced member to a receiver (anchor) — same core seam +/kebab connect uses.
 */
export async function commitPlaceLink(
  familyId: string,
  existingPersonId: string,
  relation: AddRelativeRelation,
  receiverPersonId: string,
  opts: PlaceConfirmWriteOpts = {},
  deps: PlaceConfirmLinkDeps = {},
): Promise<{ ok: boolean }> {
  const onLink =
    deps.onLink ??
    ((fid, existingId, rel, receiverId, _coParent, writeOpts) =>
      linkExistingMemberAction(fid, existingId, rel, receiverId, undefined, writeOpts));

  const coParents = opts.coParentPersonIds ?? [];
  const placement: LinkPlacement = {
    kind: "link",
    familyId,
    existingPersonId,
    relation,
    receiverPersonId,
    coParentPersonIds: coParents.length > 0 ? coParents : undefined,
    stepParentOfChildIds:
      relation === "partner" && opts.stepParentOfChildIds !== undefined
        ? opts.stepParentOfChildIds
        : undefined,
    nature: relation === "parent" || relation === "child" ? opts.nature : undefined,
  };

  const res = await commitPlacement(
    placement,
    {
      onLink: async (p) => {
        const cps = p.coParentPersonIds ?? [];
        const result = await onLink(
          p.familyId,
          p.existingPersonId,
          p.relation,
          p.receiverPersonId,
          cps.length === 1 ? cps[0] : undefined,
          {
            coParentPersonIds: cps.length > 0 ? cps : undefined,
            stepParentOfChildIds: p.stepParentOfChildIds,
            nature: p.nature,
          },
        );
        return result.ok ? { ok: true } : { ok: false };
      },
    },
    opts.anchorChildIds !== undefined ? { anchorChildIds: opts.anchorChildIds } : undefined,
  );
  return { ok: res.ok };
}

/**
 * Mint a new person and place them relative to the receiver — typed Placement, no FormData.
 */
export async function commitPlaceMint(
  familyId: string,
  relation: AddRelativeRelation,
  receiverPersonId: string,
  fields: {
    displayName?: string;
    nature?: KinshipNature;
    coParentPersonIds?: string[];
    stepParentOfChildIds?: string[];
    birthDate?: string;
    lifeStatus?: "living" | "deceased";
    deathYear?: number;
    sex?: PersonSex;
    /**
     * When provided, enforces offer-never-silent on partner commits (same as link path).
     */
    anchorChildIds?: string[];
  },
  deps: PlaceConfirmMintDeps = {},
): Promise<{ ok: boolean; error?: string }> {
  const onMint =
    deps.onMint ??
    (async (placement: MintPlacement): Promise<PlacementResult> => {
      const result = await addRelativeTypedAction(placement);
      if (result?.error) return { ok: false, error: result.error };
      return { ok: true };
    });

  const placement: MintPlacement = {
    kind: "mint",
    familyId,
    relation,
    receiverPersonId,
    displayName: fields.displayName,
    birthDate: fields.birthDate,
    lifeStatus: fields.lifeStatus,
    deathYear: fields.deathYear,
    sex: fields.sex,
    nature: relation === "parent" || relation === "child" ? fields.nature : undefined,
    coParentPersonIds:
      relation === "child" && (fields.coParentPersonIds?.length ?? 0) > 0
        ? fields.coParentPersonIds
        : undefined,
    stepParentOfChildIds:
      relation === "partner" && fields.stepParentOfChildIds !== undefined
        ? fields.stepParentOfChildIds
        : undefined,
  };

  return commitPlacement(
    placement,
    { onMint },
    fields.anchorChildIds !== undefined ? { anchorChildIds: fields.anchorChildIds } : undefined,
  );
}

export const PLACE_CONFIRM_RELATIONS: readonly AddRelativeRelation[] = [
  "parent",
  "child",
  "partner",
  "sibling",
  "grandparent",
];

export const PLACE_CONFIRM_NATURES: readonly KinshipNature[] = [
  "biological",
  "adoptive",
  "step",
  "foster",
  "unknown",
];
