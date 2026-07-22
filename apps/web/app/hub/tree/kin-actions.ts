"use server";

import { revalidatePath } from "next/cache";
import { getRuntime } from "@/lib/runtime";
import {
  addRelative,
  affirmEdge,
  correctEdge,
  denyEdge,
  hideEdge,
  listActiveFamiliesForPerson,
  unhideEdge,
  type AddRelativeInput,
  type AddRelativeRelation,
  type EdgeRef,
  type KinshipEdgeActionResult,
} from "@chronicle/core";
import type { KinshipEdgeType, KinshipNature, PersonSex } from "@chronicle/db";
import { beginLogContext, plog, plogError } from "@chronicle/pipeline";
import { hub } from "@/app/_copy";
import {
  mintPlacementToAddRelativeInput,
  type MintPlacement,
} from "./placement";

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

const VALID_SEXES: ReadonlySet<PersonSex> = new Set<PersonSex>(["male", "female", "unknown"]);

/** Never trust the raw client value: anything not one of the three valid sexes is treated as omitted
 *  (core then defaults the created person to `"unknown"`). */
function parseSex(value: FormDataEntryValue | null): PersonSex | undefined {
  return typeof value === "string" && VALID_SEXES.has(value as PersonSex)
    ? (value as PersonSex)
    : undefined;
}

const VALID_NATURES_ADD: ReadonlySet<KinshipNature> = new Set<KinshipNature>([
  "biological",
  "adoptive",
  "step",
  "foster",
  "unknown",
]);

/**
 * Shared mint write after auth + family re-validation. Used by FormData adapter and typed Placement.
 */
async function runAddRelative(input: AddRelativeInput): Promise<ActionResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  if (ctx.kind !== "account") {
    return { error: hub.actions.notSignedIn };
  }

  if (!VALID_RELATIONS.has(input.relation)) {
    return { error: hub.actions.invalidInput };
  }

  // Re-validate the submitted family against the viewer's own active families. A stale/forged scope
  // never reaches the write path; if it isn't one of theirs, fall back to their first active family
  // (matching how the page resolves the current family). A viewer in no family is rejected.
  const activeFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  if (activeFamilies.length === 0) {
    return { error: hub.actions.noFamilyForKin };
  }
  const familyId = activeFamilies.some((f) => f.familyId === input.familyId)
    ? input.familyId
    : activeFamilies[0]!.familyId;

  const resolved: AddRelativeInput = { ...input, familyId };
  const named = typeof resolved.displayName === "string" && resolved.displayName.trim() ? "yes" : "no";

  plog("kin", "addRelative: received", {
    person: ctx.personId,
    family: familyId,
    relation: resolved.relation,
    named,
  });

  try {
    const result = await addRelative(db, ctx, resolved);
    if (!result.allowed) {
      plogError("kin", "addRelative: not allowed", { family: familyId, reason: result.reason });
      return { error: result.reason ?? hub.actions.addRelativeFailed };
    }
    plog("kin", "addRelative: success", {
      family: familyId,
      relation: resolved.relation,
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

  revalidatePath("/hub");
  return undefined;
}

/**
 * Typed mint from Placement (#318). Tree tray / tap-zone / kebab mint uses this — FormData is not
 * the real seam. Validates relation and re-checks family membership server-side.
 */
export async function addRelativeTypedAction(placement: MintPlacement): Promise<ActionResult> {
  if (placement.kind !== "mint") {
    return { error: hub.actions.invalidInput };
  }
  if (!VALID_RELATIONS.has(placement.relation)) {
    return { error: hub.actions.invalidInput };
  }
  return runAddRelative(mintPlacementToAddRelativeInput(placement));
}

/**
 * FormData adapter for HTML forms (AddRelativeForm). Parses untrusted fields into a MintPlacement
 * then commits through the same typed path as tray/tap/kebab (#318).
 */
export async function addRelativeAction(formData: FormData): Promise<ActionResult> {
  const relation = parseRelation(formData.get("relation"));
  if (relation === null) {
    return { error: hub.actions.invalidInput };
  }

  const submittedFamilyId = formData.get("familyId");
  const familyId = typeof submittedFamilyId === "string" ? submittedFamilyId : "";

  const rawAnchor = formData.get("anchorPersonId");
  const receiverPersonId =
    typeof rawAnchor === "string" && rawAnchor.trim() ? rawAnchor.trim() : "";

  const rawName = formData.get("displayName");
  const displayName = typeof rawName === "string" ? rawName.trim() : "";

  const rawBirthDate = formData.get("birthDate");
  const birthDate =
    typeof rawBirthDate === "string" && rawBirthDate.trim() ? rawBirthDate.trim() : undefined;

  const rawLifeStatus = formData.get("lifeStatus");
  const lifeStatus = rawLifeStatus === "deceased" ? "deceased" : "living";

  const rawDeathYear = formData.get("deathYear");
  let deathYear: number | undefined;
  if (lifeStatus === "deceased" && typeof rawDeathYear === "string" && rawDeathYear.trim()) {
    const parsed = Number(rawDeathYear.trim());
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= new Date().getFullYear()) {
      deathYear = parsed;
    }
  }

  const sex = parseSex(formData.get("sex"));

  const coParentPersonIds =
    relation === "child"
      ? [
          ...formData.getAll("coParentPersonIds"),
          ...formData.getAll("coParentPersonId"),
        ]
          .filter((v): v is string => typeof v === "string" && !!v.trim())
          .map((v) => v.trim())
      : [];
  const uniqueCoParents = [...new Set(coParentPersonIds)];

  // Partner→kids: FormData.getAll is empty when declined — treat as explicit [] so offer-never-silent
  // can distinguish "resolved decline" from "never offered" at the Placement layer when UIs pass it.
  const stepParentOfChildIds =
    relation === "partner"
      ? [
          ...formData.getAll("stepParentOfChildIds"),
        ]
          .filter((v): v is string => typeof v === "string" && !!v.trim())
          .map((v) => v.trim())
      : undefined;
  const uniqueStepKids =
    stepParentOfChildIds !== undefined ? [...new Set(stepParentOfChildIds)] : undefined;

  const rawNature = formData.get("nature");
  const nature =
    (relation === "parent" || relation === "child") &&
    typeof rawNature === "string" &&
    VALID_NATURES_ADD.has(rawNature as KinshipNature)
      ? (rawNature as KinshipNature)
      : undefined;

  const placement: MintPlacement = {
    kind: "mint",
    familyId,
    relation,
    receiverPersonId,
    ...(displayName ? { displayName } : {}),
    ...(birthDate ? { birthDate } : {}),
    lifeStatus,
    ...(deathYear !== undefined ? { deathYear } : {}),
    ...(sex && sex !== "unknown" ? { sex } : {}),
    ...(nature ? { nature } : {}),
    ...(uniqueCoParents.length > 0 ? { coParentPersonIds: uniqueCoParents } : {}),
    ...(uniqueStepKids !== undefined ? { stepParentOfChildIds: uniqueStepKids } : {}),
  };

  return addRelativeTypedAction(placement);
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

  revalidatePath("/hub");
  return undefined;
}

/** Steward endorses an edge (#33). */
export async function affirmEdgeAction(formData: FormData): Promise<ActionResult> {
  return runEdgeAction(formData, "affirmEdge", (db, ctx, ref) => affirmEdge(db, ctx, ref));
}

/** Steward or original asserter removes an edge (#33/#256). Optional `note` reason. */
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

/** Subject hides an edge about them (#34). */
export async function hideEdgeAction(formData: FormData): Promise<ActionResult> {
  return runEdgeAction(formData, "hideEdge", (db, ctx, ref) => hideEdge(db, ctx, ref));
}

/** Subject un-hides an edge they previously hid (#34). */
export async function unhideEdgeAction(formData: FormData): Promise<ActionResult> {
  return runEdgeAction(formData, "unhideEdge", (db, ctx, ref) => unhideEdge(db, ctx, ref));
}
