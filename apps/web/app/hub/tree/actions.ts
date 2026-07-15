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
  listActiveFamiliesForPerson,
  resolveKinshipTree,
  updatePersonIdentityAsEditor,
  type EditPersonPatch,
  type KinshipTreeData,
  type TreeWindow,
} from "@chronicle/core";
import { beginLogContext, plog, plogError } from "@chronicle/pipeline";
import { getRuntime } from "@/lib/runtime";

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
