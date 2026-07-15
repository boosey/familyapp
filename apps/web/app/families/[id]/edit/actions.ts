"use server";
/**
 * Server action for the steward-only Edit-a-Family surface (#54). Extracted from the page so it can
 * be unit-tested in isolation. Re-checks stewardship server-side via core's updateFamily (defence in
 * depth against a tampered hidden familyId): AuthorizationError/InvariantViolation → /hub.
 */
import { redirect } from "next/navigation";
import { getRuntime } from "@/lib/runtime";
import { AuthorizationError, InvariantViolation, updateFamily } from "@chronicle/core";

export async function updateFamilyAction(formData: FormData): Promise<void> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  const familyId = String(formData.get("familyId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const shortName = String(formData.get("shortName") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const discoverable = formData.get("discoverable") === "on";
  if (!familyId) redirect("/hub");
  if (!name) redirect(`/families/${familyId}/edit?error=name`);

  try {
    await updateFamily(db, {
      familyId,
      actorPersonId: ctx.personId,
      name,
      shortName: shortName || null,
      description: description || null,
      discoverable,
    });
  } catch (err) {
    if (err instanceof AuthorizationError || err instanceof InvariantViolation) redirect("/hub");
    throw err;
  }
  redirect("/hub");
}
