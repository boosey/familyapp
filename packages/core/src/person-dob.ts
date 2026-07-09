/**
 * Date-of-birth validation shared by onboarding and post-onboarding profile edits.
 */
import { InvariantViolation } from "./errors";

/** True only if (year, month, day) is a real calendar date — rejects e.g. Feb 31, Apr 31. */
export function isRealCalendarDate(year: number, month: number, day: number): boolean {
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
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Validate a calendar date of birth and return its ISO form. Rejects non-real dates and future
 * dates (relative to `now`, defaulting to the current instant).
 */
export function validateBirthDate(
  year: number,
  month: number,
  day: number,
  now: Date = new Date(),
): string {
  if (!isRealCalendarDate(year, month, day)) {
    throw new InvariantViolation(
      `date of birth ${year}-${month}-${day} is not a real calendar date`,
    );
  }
  const birthDate = toIsoDate(year, month, day);
  const todayIso = toIsoDate(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    now.getUTCDate(),
  );
  if (birthDate > todayIso) {
    throw new InvariantViolation(`date of birth ${birthDate} is in the future`);
  }
  return birthDate;
}
