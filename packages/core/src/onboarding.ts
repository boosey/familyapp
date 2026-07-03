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
import { defaultSpokenName } from "./names";

export interface CompleteOnboardingInput {
  /**
   * The person's own name, as typed into /welcome. Required — this is the write that guarantees a
   * real, user-entered name lands before the `onboarded_at` gate, instead of the email-prefix
   * fallback that JIT provisioning leaves as a placeholder.
   */
  displayName: string;
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
 * Persist the required onboarding facts — the person's own name and full date of birth — and stamp
 * `onboarded_at = now()`, which is the gate that routes the Person to the hub from here on. One
 * atomic UPDATE means the name and the gate stamp land together: there is no reachable state past
 * the /welcome gate where the Person still carries the email-prefix placeholder. Rejects an
 * empty/whitespace name, a date that is not a real calendar date (e.g. Feb 31), or a future date —
 * all with `InvariantViolation`. Idempotent in shape: re-running overwrites the same fields,
 * including re-deriving `spokenName` from the newly entered name.
 */
export async function completeOnboarding(
  db: Database,
  personId: string,
  input: CompleteOnboardingInput,
): Promise<void> {
  // Name first: the cheaper check and the more fundamental precondition (a real, user-entered name
  // is the whole point of this write). Nothing is written if it fails.
  const displayName = input.displayName.trim();
  if (displayName.length === 0) {
    throw new InvariantViolation("displayName is required");
  }

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
    .set({
      displayName,
      spokenName: defaultSpokenName(displayName),
      birthDate,
      birthYear: year,
      onboardedAt: now,
    })
    .where(eq(persons.id, personId));
}
