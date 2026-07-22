/**
 * Shared place-confirm seam (#286 / ADR-0027) — types, zone→relation mapping, and write helpers
 * used by the Tree tray (unplaced link + New person mint) and by secondary +/kebab paths.
 *
 * Desktop DnD (#287) and mobile Place→tap (#288) open the same PlaceConfirmModal with
 * `receiverLocked: true` and `initialRelation` from {@link relationFromZone}.
 */
import type { AddRelativeRelation } from "@chronicle/core";
import type { KinshipNature } from "@chronicle/db";
import { addRelativeAction } from "../kin/actions";
import { linkExistingMemberAction } from "./actions";

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
};

export type PlaceConfirmLinkDeps = {
  onLink?: typeof linkExistingMemberAction;
};

export type PlaceConfirmMintDeps = {
  onMint?: typeof addRelativeAction;
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
  const onLink = deps.onLink ?? linkExistingMemberAction;
  const coParents = opts.coParentPersonIds ?? [];
  const res = await onLink(
    familyId,
    existingPersonId,
    relation,
    receiverPersonId,
    coParents.length === 1 ? coParents[0] : undefined,
    {
      coParentPersonIds: coParents.length > 0 ? coParents : undefined,
      stepParentOfChildIds:
        relation === "partner" && (opts.stepParentOfChildIds?.length ?? 0) > 0
          ? opts.stepParentOfChildIds
          : undefined,
      nature: relation === "parent" || relation === "child" ? opts.nature : undefined,
    },
  );
  return { ok: res.ok };
}

/**
 * Mint a new person and place them relative to the receiver — same core seam +/kebab mint uses.
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
  },
  deps: PlaceConfirmMintDeps = {},
): Promise<{ ok: boolean; error?: string }> {
  const onMint = deps.onMint ?? addRelativeAction;
  const fd = new FormData();
  fd.set("familyId", familyId);
  fd.set("anchorPersonId", receiverPersonId);
  fd.set("relation", relation);
  if (fields.displayName?.trim()) fd.set("displayName", fields.displayName.trim());
  if ((relation === "parent" || relation === "child") && fields.nature) {
    fd.set("nature", fields.nature);
  }
  if (relation === "child") {
    for (const id of fields.coParentPersonIds ?? []) {
      fd.append("coParentPersonIds", id);
    }
  }
  if (relation === "partner") {
    for (const id of fields.stepParentOfChildIds ?? []) {
      fd.append("stepParentOfChildIds", id);
    }
  }
  const result = await onMint(fd);
  if (result?.error) return { ok: false, error: result.error };
  return { ok: true };
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
