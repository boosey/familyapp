"use server";

import { revalidatePath } from "next/cache";
import { getRuntime } from "@/lib/runtime";
import {
  addRelative,
  listActiveFamiliesForPerson,
  type AddRelativeInput,
  type AddRelativeRelation,
} from "@chronicle/core";
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
