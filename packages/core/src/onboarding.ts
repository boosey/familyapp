/**
 * Onboarding writes — the Person identity-lifecycle transitions the /welcome flow performs.
 *
 * These live in core (not in the web server actions that call them) for the same reason
 * `createAccountWithPerson` does: they are identity-lifecycle rules, and `completeOnboarding` in
 * particular performs the load-bearing state transition the whole app gates on — stamping
 * `onboarded_at`, which flips the Person from the /welcome gate to the hub/family flow. The
 * persons table is on the OPEN schema (identity, not story content), so a direct write is allowed
 * here — but the VALIDATION of that write belongs in one audited place, not re-derived per caller.
 */
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import { InvariantViolation } from "./errors";

export interface CompleteOnboardingInput {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  /** Injectable clock so "not in the future" is testable. Defaults to now. */
  now?: Date;
}

/** True only if (year, month, day) is a real calendar date — rejects e.g. Feb 31, Apr 31. */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }
  // Construct in UTC and require every component to round-trip — JS normalizes Feb 31 to Mar 3,
  // so a non-real date fails this equality check.
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Persist the one required onboarding fact (full date of birth) and stamp `onboarded_at = now()`,
 * which is the gate that routes the Person to the hub from here on. Rejects a date that is not a
 * real calendar date (e.g. Feb 31) or that lies in the future — both with `InvariantViolation`.
 * Idempotent in shape: re-running overwrites the same three fields.
 */
export async function completeOnboarding(
  db: Database,
  personId: string,
  input: CompleteOnboardingInput,
): Promise<void> {
  const { year, month, day } = input;
  if (!isRealCalendarDate(year, month, day)) {
    throw new InvariantViolation(
      `date of birth ${year}-${month}-${day} is not a real calendar date`,
    );
  }
  const now = input.now ?? new Date();
  const birthDate = toIsoDate(year, month, day);
  // Compare against today in UTC date terms (a DOB of "today" is valid; tomorrow is not).
  const todayIso = toIsoDate(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    now.getUTCDate(),
  );
  if (birthDate > todayIso) {
    throw new InvariantViolation(
      `date of birth ${birthDate} is in the future`,
    );
  }

  await db
    .update(persons)
    .set({ birthDate, birthYear: year, onboardedAt: now })
    .where(eq(persons.id, personId));
}

export interface InterviewAnchors {
  birthplace?: string;
  placesLived?: string[];
  keyMoments?: string[];
}

/**
 * Merge the lightweight interview answers into `persons.biographical_anchors` (the seam the
 * interviewer warms up from). Read-modify-write inside one transaction so concurrent partial saves
 * cannot lose an update; only ever ADDS non-empty keys, never clears existing anchors — the user
 * may exit the interview at any question and whatever was answered is preserved.
 */
export async function recordInterviewAnchors(
  db: Database,
  personId: string,
  facts: InterviewAnchors,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ anchors: persons.biographicalAnchors })
      .from(persons)
      .where(eq(persons.id, personId))
      .limit(1);
    const merged: Record<string, unknown> = { ...(row?.anchors ?? {}) };

    const birthplace = facts.birthplace?.trim();
    if (birthplace) merged.birthplace = birthplace;
    const placesLived = facts.placesLived?.map((s) => s.trim()).filter(Boolean);
    if (placesLived && placesLived.length) merged.placesLived = placesLived;
    const keyMoments = facts.keyMoments?.map((s) => s.trim()).filter(Boolean);
    if (keyMoments && keyMoments.length) merged.keyMoments = keyMoments;

    await tx
      .update(persons)
      .set({ biographicalAnchors: merged })
      .where(eq(persons.id, personId));
  });
}
