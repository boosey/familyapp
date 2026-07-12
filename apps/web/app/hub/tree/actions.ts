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
  listActiveFamiliesForPerson,
  resolveKinshipTree,
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
