"use server";

import { revalidatePath } from "next/cache";
import { getRuntime } from "@/lib/runtime";
import {
  addRelative,
  affirmEdge,
  correctEdge,
  denyEdge,
  listActiveFamiliesForPerson,
  type AddRelativeInput,
  type AddRelativeRelation,
  type EdgeRef,
  type KinshipEdgeActionResult,
} from "@chronicle/core";
import type { KinshipEdgeType, KinshipNature } from "@chronicle/db";
import { beginLogContext, plog, plogError } from "@chronicle/pipeline";
import { hub } from "@/app/_copy";

export type ActionResult = { error: string } | undefined;

/** The five relations the v1 add-relative form offers (mirrors core's AddRelativeRelation). */
const VALID_RELATIONS: ReadonlySet<AddRelativeRelation> = new Set<AddRelativeRelation>([
  "parent",
  "child",
  "partner",
  "grandparent",
  "sibling",
]);

function parseRelation(value: FormDataEntryValue | null): AddRelativeRelation | null {
  return typeof value === "string" && VALID_RELATIONS.has(value as AddRelativeRelation)
    ? (value as AddRelativeRelation)
    : null;
}

/**
 * Add a relative from the /hub/kin form (issue #32). Follows the stories-actions pattern:
 * beginLogContext → getRuntime → auth guard → parse → core call → revalidate.
 *
 * Everything is RE-RESOLVED server-side and never trusted from the client:
 *   - the family id carried in the hidden `familyId` field is re-validated against the viewer's OWN
 *     active families (core's addRelative re-checks active membership too — this is defense in depth);
 *   - an empty name string is OMITTED so core mints an anonymous bridge relative (identified=false);
 *   - relation is validated against the five allowed values.
 */
export async function addRelativeAction(formData: FormData): Promise<ActionResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (ctx.kind !== "account") {
    return { error: hub.actions.notSignedIn };
  }

  const relation = parseRelation(formData.get("relation"));
  if (relation === null) {
    return { error: hub.actions.invalidInput };
  }

  // Re-validate the submitted family against the viewer's own active families. A stale/forged scope
  // never reaches the write path; if it isn't one of theirs, fall back to their first active family
  // (matching how the page resolves the current family). A viewer in no family is rejected.
  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  if (activeFamilies.length === 0) {
    return { error: hub.actions.noFamilyForKin };
  }
  const submittedFamilyId = formData.get("familyId");
  const familyId =
    typeof submittedFamilyId === "string" &&
    activeFamilies.some((f) => f.familyId === submittedFamilyId)
      ? submittedFamilyId
      : activeFamilies[0]!.familyId;

  const rawName = formData.get("displayName");
  const trimmedName = typeof rawName === "string" ? rawName.trim() : "";

  const rawBirthDate = formData.get("birthDate");
  const birthDate =
    typeof rawBirthDate === "string" && rawBirthDate.trim() ? rawBirthDate.trim() : undefined;

  const rawLifeStatus = formData.get("lifeStatus");
  const lifeStatus = rawLifeStatus === "deceased" ? "deceased" : "living";

  const input: AddRelativeInput = {
    familyId,
    relation,
    // Empty => omit, so core creates an anonymous bridge relative (identified=false).
    ...(trimmedName ? { displayName: trimmedName } : {}),
    ...(birthDate ? { birthDate } : {}),
    lifeStatus,
  };

  plog("kin", "addRelative: received", {
    person: ctx.personId,
    family: familyId,
    relation,
    named: trimmedName ? "yes" : "no",
  });

  try {
    const result = await addRelative(db, ctx, input);
    if (!result.allowed) {
      plogError("kin", "addRelative: not allowed", { family: familyId, reason: result.reason });
      return { error: result.reason ?? hub.actions.addRelativeFailed };
    }
    plog("kin", "addRelative: success", {
      family: familyId,
      relation,
      person: result.createdPersonId,
      bridge: result.bridgePersonId ?? "none",
    });
  } catch (err) {
    plogError("kin", "addRelative: error", {
      family: familyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.actions.addRelativeFailed };
  }

  revalidatePath("/hub/kin");
  return undefined;
}

// ---------------------------------------------------------------------------
// Steward governance (issue #33) + subject hide (issue #34) actions.
//
// Same discipline as addRelativeAction: beginLogContext → getRuntime → auth
// guard → parse the edge identity from the form → core call (which RE-CHECKS
// every gate server-side — steward role for governance, self-endpoint for hide)
// → revalidate. The form fields are UNTRUSTED; core is the authority.
// ---------------------------------------------------------------------------

const VALID_EDGE_TYPES: ReadonlySet<KinshipEdgeType> = new Set<KinshipEdgeType>([
  "parent_of",
  "partnered_with",
]);
const VALID_NATURES: ReadonlySet<KinshipNature> = new Set<KinshipNature>([
  "biological",
  "adoptive",
  "step",
  "foster",
  "unknown",
]);

/** Parse a logical edge identity from the submitted form. Returns null if any field is malformed. */
function parseEdgeRef(formData: FormData): EdgeRef | null {
  const familyId = formData.get("familyId");
  const edgeType = formData.get("edgeType");
  const personAId = formData.get("personAId");
  const personBId = formData.get("personBId");
  if (
    typeof familyId !== "string" ||
    typeof edgeType !== "string" ||
    !VALID_EDGE_TYPES.has(edgeType as KinshipEdgeType) ||
    typeof personAId !== "string" ||
    typeof personBId !== "string" ||
    !familyId ||
    !personAId ||
    !personBId
  ) {
    return null;
  }
  return { familyId, edgeType: edgeType as KinshipEdgeType, personAId, personBId };
}

/**
 * Shared runner for the five edge actions. Resolves auth, parses the edge, invokes `run` (the core
 * call that owns the real authorization), maps a `{allowed:false}` to an error, and revalidates. The
 * family id is re-validated against the viewer's own active families so a forged edge can't target a
 * family the viewer doesn't belong to (core re-checks steward/endpoint on top).
 */
async function runEdgeAction(
  formData: FormData,
  logLabel: string,
  run: (
    db: Awaited<ReturnType<typeof getRuntime>>["db"],
    ctx: { kind: "account"; personId: string },
    ref: EdgeRef,
  ) => Promise<KinshipEdgeActionResult>,
): Promise<ActionResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    return { error: hub.actions.notSignedIn };
  }

  const ref = parseEdgeRef(formData);
  if (ref === null) {
    return { error: hub.actions.invalidInput };
  }

  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  if (!activeFamilies.some((f) => f.familyId === ref.familyId)) {
    return { error: hub.actions.invalidInput };
  }

  try {
    const result = await run(db, ctx, ref);
    if (!result.allowed) {
      plogError("kin", `${logLabel}: not allowed`, { family: ref.familyId, reason: result.reason });
      return { error: result.reason ?? hub.kin.govActionFailed };
    }
    plog("kin", `${logLabel}: success`, { family: ref.familyId });
  } catch (err) {
    plogError("kin", `${logLabel}: error`, {
      family: ref.familyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.kin.govActionFailed };
  }

  revalidatePath("/hub/kin");
  return undefined;
}

/** Steward endorses an edge (#33). */
export async function affirmEdgeAction(formData: FormData): Promise<ActionResult> {
  return runEdgeAction(formData, "affirmEdge", (db, ctx, ref) => affirmEdge(db, ctx, ref));
}

/** Steward removes an edge (#33). Optional `note` reason. */
export async function denyEdgeAction(formData: FormData): Promise<ActionResult> {
  const rawNote = formData.get("note");
  const note = typeof rawNote === "string" && rawNote.trim() ? rawNote.trim() : null;
  return runEdgeAction(formData, "denyEdge", (db, ctx, ref) => denyEdge(db, ctx, ref, note));
}

/** Steward corrects a parent_of edge's nature (#33). */
export async function correctEdgeAction(formData: FormData): Promise<ActionResult> {
  const rawNature = formData.get("nature");
  if (typeof rawNature !== "string" || !VALID_NATURES.has(rawNature as KinshipNature)) {
    return { error: hub.actions.invalidInput };
  }
  const nature = rawNature as KinshipNature;
  return runEdgeAction(formData, "correctEdge", (db, ctx, ref) =>
    correctEdge(db, ctx, { ref, nature }),
  );
}

