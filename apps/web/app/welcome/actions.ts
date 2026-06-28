"use server";

/**
 * Onboarding server actions. These are the only writes the /welcome flow performs, and they touch
 * ONLY the Person's own identity row (persons is on the public schema surface — identity, not story
 * content, so a direct db.update is allowed here). Each action re-resolves the auth context server-
 * side; the client never passes a personId.
 */
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";

export interface DobInput {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/**
 * Persist the one required onboarding fact: full date of birth. Writes birth_date (calendar date),
 * birth_year (the coarse anchor the interviewer already reads), and stamps onboarded_at = now() —
 * which flips the onboarding gate so the Person is routed to the hub/family flow from here on.
 */
export async function saveDob(input: DobInput): Promise<void> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");

  const { year, month, day } = input;
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error("invalid date of birth");
  }

  const birthDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  await db
    .update(persons)
    .set({ birthDate, birthYear: year, onboardedAt: new Date() })
    .where(eq(persons.id, ctx.personId));
}

export interface InterviewFacts {
  birthplace?: string;
  placesLived?: string[];
  keyMoments?: string[];
}

/**
 * Merge the lightweight interview answers into persons.biographical_anchors (the seam the
 * interviewer warms up from). Read-modify-write merge so partial progress — the user may exit at
 * any question — only ever adds keys, never clears existing anchors. NOT wired to the
 * audio/transcribe pipeline; these are typed/stub answers.
 */
export async function saveInterviewFacts(facts: InterviewFacts): Promise<void> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");

  const [row] = await db
    .select({ anchors: persons.biographicalAnchors })
    .from(persons)
    .where(eq(persons.id, ctx.personId))
    .limit(1);
  const merged: Record<string, unknown> = { ...(row?.anchors ?? {}) };

  const birthplace = facts.birthplace?.trim();
  if (birthplace) merged.birthplace = birthplace;
  const placesLived = facts.placesLived?.map((s) => s.trim()).filter(Boolean);
  if (placesLived && placesLived.length) merged.placesLived = placesLived;
  const keyMoments = facts.keyMoments?.map((s) => s.trim()).filter(Boolean);
  if (keyMoments && keyMoments.length) merged.keyMoments = keyMoments;

  await db
    .update(persons)
    .set({ biographicalAnchors: merged })
    .where(eq(persons.id, ctx.personId));
}
