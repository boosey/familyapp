"use server";
/**
 * Tree fetch-on-expand server action (spec §5/§7).
 *
 * The visual tree loads a BOUNDED neighborhood; when the viewer taps a boundary caret (a node whose
 * kin aren't yet loaded), the client calls this to fetch that subtree centered on the boundary person,
 * then merges the returned nodes/edges into its set. Re-centering (`?root=`) is plain navigation and
 * needs no action.
 *
 * Mirrors /hub/kin/actions.ts discipline: beginLogContext → getRuntime → auth guard → family
 * re-validation against the viewer's OWN active families → core call. `resolveKinshipTree` re-checks
 * membership + applies the subject-hide overlay itself; this is defense in depth. The core read
 * rejects anonymous viewers upstream, so a signed-out caller can never reach kinship data.
 */
import {
  AuthorizationError,
  canEditPerson,
  endMembership,
  linkExistingMember,
  listActiveFamiliesForPerson,
  listPlacedPersons,
  resolveKinshipProjection,
  resolveKinshipTree,
  setMemberNonFamily,
  updatePersonIdentityAsEditor,
  type AddRelativeRelation,
  type EditPersonPatch,
  type KinshipTreeData,
  type PlacedPersonView,
  type TreeWindow,
} from "@chronicle/core";
import type { KinshipNature } from "@chronicle/db";
import { beginLogContext, plog, plogError } from "@chronicle/pipeline";
import { revalidatePath } from "next/cache";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";

export type FetchSubtreeResult =
  | { ok: true; data: KinshipTreeData }
  | { ok: false; error: "unauthorized" | "invalid" | "failed" };

/**
 * Load a bounded subtree of `familyId` centered on `centerPersonId`. All inputs are UNTRUSTED and
 * re-validated server-side: the family must be one of the viewer's active families; the person and
 * every gate are re-checked inside `resolveKinshipTree`. Returns a serializable `KinshipTreeData` the
 * client merges (dedup by personId / normalized edge key) into what it already has.
 */
export async function fetchSubtreeAction(
  familyId: string,
  centerPersonId: string,
  window?: TreeWindow,
): Promise<FetchSubtreeResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (ctx.kind !== "account") {
    return { ok: false, error: "unauthorized" };
  }

  if (typeof familyId !== "string" || !familyId || typeof centerPersonId !== "string" || !centerPersonId) {
    return { ok: false, error: "invalid" };
  }

  // Re-validate the family against the viewer's OWN active families — a forged scope never reaches the
  // read (core re-checks membership too).
  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  if (!activeFamilies.some((f) => f.familyId === familyId)) {
    return { ok: false, error: "invalid" };
  }

  try {
    const data = await resolveKinshipTree(db, ctx, familyId, centerPersonId, window);
    plog("tree", "fetchSubtree: success", {
      family: familyId,
      center: centerPersonId,
      nodes: data.nodes.length,
      edges: data.edges.length,
    });
    return { ok: true, data };
  } catch (err) {
    plogError("tree", "fetchSubtree: error", {
      family: familyId,
      center: centerPersonId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { ok: false, error: "failed" };
  }
}

// ---------------------------------------------------------------------------
// ADR-0021 (tree Slice C) — details-sheet EDIT mode.
//
// The predicate `canEditPerson` is NEVER shipped to the client. `personEditabilityAction` projects a
// single boolean the sheet uses to decide whether to show Edit; `savePersonEditAction` wraps the core
// write choke point (which RE-CHECKS the predicate — so a forged "editable" can never write). Both
// re-validate the family against the viewer's OWN active families, mirroring fetchSubtreeAction.
// ---------------------------------------------------------------------------

export type PersonEditabilityResult =
  | { ok: true; editable: boolean }
  | { ok: false; error: "unauthorized" | "invalid" };

/**
 * Project whether the viewer may edit `personId` (ADR-0021), scoped to a family the viewer belongs to.
 * The result is a bare boolean; the policy stays server-side. `familyId` is re-validated so a
 * non-member cannot probe editability of persons outside their own families.
 */
export async function personEditabilityAction(
  familyId: string,
  personId: string,
): Promise<PersonEditabilityResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { ok: false, error: "unauthorized" };
  if (typeof familyId !== "string" || !familyId || typeof personId !== "string" || !personId) {
    return { ok: false, error: "invalid" };
  }
  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  if (!activeFamilies.some((f) => f.familyId === familyId)) {
    return { ok: false, error: "invalid" };
  }
  const decision = await canEditPerson(db, ctx, personId);
  return { ok: true, editable: decision.allowed };
}

export type SavePersonEditResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "invalid" | "not-allowed" | "bad-input" | "failed" };

/**
 * Persist an identity edit to `personId` via the core choke point (ADR-0021). The core function
 * re-checks `canEditPerson`, so a client that forged the `editable` flag is still rejected here
 * (`AuthorizationError` → `not-allowed`). `familyId` is re-validated against the viewer's active
 * families before the write. Validation errors (bad date, empty name) map to `bad-input`.
 */
export async function savePersonEditAction(
  familyId: string,
  personId: string,
  patch: EditPersonPatch,
): Promise<SavePersonEditResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { ok: false, error: "unauthorized" };
  if (typeof familyId !== "string" || !familyId || typeof personId !== "string" || !personId) {
    return { ok: false, error: "invalid" };
  }
  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  if (!activeFamilies.some((f) => f.familyId === familyId)) {
    return { ok: false, error: "invalid" };
  }
  try {
    await updatePersonIdentityAsEditor(db, ctx, personId, patch);
    plog("tree", "savePersonEdit: success", { family: familyId, person: personId });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { ok: false, error: "not-allowed" };
    }
    // InvariantViolation (bad name / date) → bad-input; anything else → failed.
    const name = err instanceof Error ? err.name : "";
    if (name === "InvariantViolation") {
      return { ok: false, error: "bad-input" };
    }
    plogError("tree", "savePersonEdit: error", {
      family: familyId,
      person: personId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { ok: false, error: "failed" };
  }
}

// ---------------------------------------------------------------------------
// Unplaced-member curation (#161, ADR-0023). Three server actions backing the
// Family tab's "unplaced members" surface (tray on the tree, section in the
// list). Each RE-VALIDATES the family against the viewer's OWN active families
// before calling core — a forged/foreign scope never reaches the write path —
// mirroring fetchSubtreeAction. Core re-checks every gate on top (active
// member for link/non-family, steward for remove), so these projections never
// widen authority; they just spare the client a round-trip to a rejected call.
// ---------------------------------------------------------------------------

/** The five relations the place-in-tree flow offers (mirrors core's AddRelativeRelation). */
const VALID_LINK_RELATIONS: ReadonlySet<AddRelativeRelation> = new Set<AddRelativeRelation>([
  "parent",
  "child",
  "partner",
  "grandparent",
  "sibling",
]);

/** Resolve auth + re-validate `familyId` against the viewer's active families. */
async function resolveFamilyScopedActor(
  familyId: string,
): Promise<
  | { ok: true; db: Awaited<ReturnType<typeof getRuntime>>["db"]; ctx: { kind: "account"; personId: string } }
  | { ok: false; error: "unauthorized" | "invalid" }
> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { ok: false, error: "unauthorized" };
  if (typeof familyId !== "string" || !familyId) return { ok: false, error: "invalid" };
  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  if (!activeFamilies.some((f) => f.familyId === familyId)) return { ok: false, error: "invalid" };
  return { ok: true, db, ctx };
}

export type PlacedPersonsResult =
  | { ok: true; persons: PlacedPersonView[] }
  | { ok: false; error: "unauthorized" | "invalid" | "failed" };

/**
 * List people who may anchor an unplaced-member placement (#169, #250). Prefer endpoints of visible
 * kinship edges; when the family has no edges yet, core falls back to active members so a lone
 * tree person is still offered. Re-validates the family against the viewer's active families.
 */
export async function listPlacedPersonsAction(
  familyId: string,
): Promise<PlacedPersonsResult> {
  beginLogContext();
  const scoped = await resolveFamilyScopedActor(familyId);
  if (!scoped.ok) return scoped;
  try {
    const persons = await listPlacedPersons(scoped.db, scoped.ctx, familyId);
    plog("tree", "listPlacedPersons: success", { family: familyId, count: persons.length });
    return { ok: true, persons };
  } catch (err) {
    plogError("tree", "listPlacedPersons: error", {
      family: familyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { ok: false, error: "failed" };
  }
}

export type PersonKinOptionsResult =
  | {
      ok: true;
      partners: { id: string; name: string }[];
      children: { id: string; name: string }[];
    }
  | { ok: false; error: "unauthorized" | "invalid" | "failed" };

/**
 * Partners + children of a placed person for Place-form confirm UI (#285 / ADR-0027). Derived from
 * the family's visible kinship projection — never invents edges. Used for co-parent checkboxes
 * (child place) and the partner→kids step offer.
 */
export async function listPersonKinOptionsAction(
  familyId: string,
  personId: string,
): Promise<PersonKinOptionsResult> {
  beginLogContext();
  const scoped = await resolveFamilyScopedActor(familyId);
  if (!scoped.ok) return scoped;
  if (typeof personId !== "string" || !personId) return { ok: false, error: "invalid" };
  try {
    const { edges } = await resolveKinshipProjection(scoped.db, scoped.ctx, familyId);
    const partnerIds: string[] = [];
    const childIds: string[] = [];
    for (const e of edges) {
      if (e.edgeType === "partnered_with") {
        const other =
          e.personAId === personId ? e.personBId : e.personBId === personId ? e.personAId : null;
        if (other) partnerIds.push(other);
      } else if (e.edgeType === "parent_of" && e.personAId === personId) {
        childIds.push(e.personBId);
      }
    }
    // Names from the placed-person catalog (active members + edge endpoints); fall back for bridges.
    const catalog = await listPlacedPersons(scoped.db, scoped.ctx, familyId);
    const nameById = new Map(
      catalog.map((p) => [p.personId, p.displayName?.trim() || hub.kin.edgeUnknownPerson] as const),
    );
    const nameOf = (id: string) => nameById.get(id) ?? hub.kin.edgeUnknownPerson;
    return {
      ok: true,
      partners: partnerIds.map((id) => ({ id, name: nameOf(id) })),
      children: childIds.map((id) => ({ id, name: nameOf(id) })),
    };
  } catch (err) {
    plogError("tree", "listPersonKinOptions: error", {
      family: familyId,
      person: personId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { ok: false, error: "failed" };
  }
}

export type LinkExistingMemberActionResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "invalid" | "not-allowed" | "failed" };

/**
 * Place an EXISTING unplaced member into the tree by attaching them to an anchor with a chosen relation
 * (#161). `existingPersonId` is the member being placed; `anchorPersonId` is the person they attach to.
 * All ids are UNTRUSTED — core's `linkExistingMember` re-validates membership/attachability and NEVER
 * mints a duplicate of the member. Returns `not-allowed` for a rejected link (with no leak of why).
 */
export async function linkExistingMemberAction(
  familyId: string,
  existingPersonId: string,
  relation: AddRelativeRelation,
  anchorPersonId?: string,
  /** Optional second parent when relation=child (same semantics as addRelative). Prefer `opts.coParentPersonIds`. */
  coParentPersonId?: string,
  opts?: {
    coParentPersonIds?: string[];
    stepParentOfChildIds?: string[];
    nature?: KinshipNature;
  },
): Promise<LinkExistingMemberActionResult> {
  beginLogContext();
  const scoped = await resolveFamilyScopedActor(familyId);
  if (!scoped.ok) return scoped;
  if (typeof existingPersonId !== "string" || !existingPersonId) {
    return { ok: false, error: "invalid" };
  }
  if (!VALID_LINK_RELATIONS.has(relation)) {
    return { ok: false, error: "invalid" };
  }
  const anchor =
    typeof anchorPersonId === "string" && anchorPersonId.trim() ? anchorPersonId.trim() : undefined;
  const coParents = [
    ...(opts?.coParentPersonIds ?? []),
    ...(relation === "child" && typeof coParentPersonId === "string" && coParentPersonId.trim()
      ? [coParentPersonId.trim()]
      : []),
  ];
  const uniqueCoParents = [...new Set(coParents)];
  const stepKids =
    relation === "partner" && opts?.stepParentOfChildIds
      ? [...new Set(opts.stepParentOfChildIds.filter((id) => typeof id === "string" && id.trim()))]
      : [];
  try {
    const result = await linkExistingMember(scoped.db, scoped.ctx, {
      familyId,
      relation,
      existingPersonId,
      ...(anchor ? { anchorPersonId: anchor } : {}),
      ...(uniqueCoParents.length === 1 ? { coParentPersonId: uniqueCoParents[0] } : {}),
      ...(uniqueCoParents.length > 0 ? { coParentPersonIds: uniqueCoParents } : {}),
      ...(stepKids.length > 0 ? { stepParentOfChildIds: stepKids } : {}),
      ...(opts?.nature ? { nature: opts.nature } : {}),
    });
    if (!result.allowed) {
      plogError("tree", "linkExistingMember: not allowed", { family: familyId, reason: result.reason });
      return { ok: false, error: "not-allowed" };
    }
    plog("tree", "linkExistingMember: success", { family: familyId, person: existingPersonId, relation });
    revalidatePath("/hub");
    return { ok: true };
  } catch (err) {
    plogError("tree", "linkExistingMember: error", {
      family: familyId,
      person: existingPersonId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { ok: false, error: "failed" };
  }
}

export type MemberCurationActionResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "invalid" | "not-allowed" | "failed" };

/**
 * Toggle a member's `non_family` flag (#161). `nonFamily:true` removes them from the unplaced surface;
 * `false` restores them. Any active member may curate (core enforces this). Reversible.
 */
export async function setMemberNonFamilyAction(
  familyId: string,
  personId: string,
  nonFamily: boolean,
): Promise<MemberCurationActionResult> {
  beginLogContext();
  const scoped = await resolveFamilyScopedActor(familyId);
  if (!scoped.ok) return scoped;
  if (typeof personId !== "string" || !personId || typeof nonFamily !== "boolean") {
    return { ok: false, error: "invalid" };
  }
  try {
    await setMemberNonFamily(scoped.db, scoped.ctx, { familyId, personId, nonFamily });
    plog("tree", "setMemberNonFamily: success", { family: familyId, person: personId, nonFamily });
    revalidatePath("/hub");
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthorizationError) return { ok: false, error: "not-allowed" };
    plogError("tree", "setMemberNonFamily: error", {
      family: familyId,
      person: personId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { ok: false, error: "failed" };
  }
}

/**
 * End a member's active membership (#161) — STEWARD-ONLY (core re-checks). Access revocation is
 * automatic; authored stories and kinship edges are untouched. A non-steward caller is rejected with
 * `not-allowed` (core throws `AuthorizationError`).
 */
export async function endMembershipAction(
  familyId: string,
  personId: string,
): Promise<MemberCurationActionResult> {
  beginLogContext();
  const scoped = await resolveFamilyScopedActor(familyId);
  if (!scoped.ok) return scoped;
  if (typeof personId !== "string" || !personId) {
    return { ok: false, error: "invalid" };
  }
  try {
    await endMembership(scoped.db, scoped.ctx, { familyId, personId });
    plog("tree", "endMembership: success", { family: familyId, person: personId });
    revalidatePath("/hub");
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthorizationError) return { ok: false, error: "not-allowed" };
    plogError("tree", "endMembership: error", {
      family: familyId,
      person: personId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { ok: false, error: "failed" };
  }
}
