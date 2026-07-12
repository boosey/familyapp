/**
 * Post-onboarding Person identity edits — name and date of birth.
 *
 * The persons table is on the open schema (identity, not story content), so direct writes are
 * allowed. Validation lives here so profile edits and onboarding share one set of rules.
 */
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import type { Database, PersonSex } from "@chronicle/db";
import { InvariantViolation } from "./errors";
import { defaultSpokenName } from "./names";
import { validateBirthDate } from "./person-dob";

export interface UpdatePersonIdentityInput {
  displayName: string;
  /** When omitted, spokenName is re-derived from displayName. */
  spokenName?: string;
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  now?: Date;
}

function requireDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) {
    throw new InvariantViolation("displayName is required");
  }
  return trimmed;
}

function requireSpokenName(spokenName: string): string {
  const trimmed = spokenName.trim();
  if (trimmed.length === 0) {
    throw new InvariantViolation("spokenName is required");
  }
  return trimmed;
}

export async function updatePersonDisplayName(
  db: Database,
  personId: string,
  displayName: string,
): Promise<void> {
  await db
    .update(persons)
    .set({
      displayName: requireDisplayName(displayName),
      updatedAt: new Date(),
    })
    .where(eq(persons.id, personId));
}

export async function updatePersonSpokenName(
  db: Database,
  personId: string,
  spokenName: string,
): Promise<void> {
  await db
    .update(persons)
    .set({
      spokenName: requireSpokenName(spokenName),
      updatedAt: new Date(),
    })
    .where(eq(persons.id, personId));
}

export async function updatePersonBirthDate(
  db: Database,
  personId: string,
  input: { year: number; month: number; day: number; now?: Date },
): Promise<void> {
  const birthDate = validateBirthDate(
    input.year,
    input.month,
    input.day,
    input.now ?? new Date(),
  );
  await db
    .update(persons)
    .set({
      birthDate,
      birthYear: input.year,
      updatedAt: new Date(),
    })
    .where(eq(persons.id, personId));
}

/** ADR-0016 tree renderer — the profile editor's Sex control. Same three values as the add-relative
 *  form (`male`/`female`/`unknown`); validation is the caller's job (this just persists). */
export async function updatePersonSex(
  db: Database,
  personId: string,
  sex: PersonSex,
): Promise<void> {
  await db
    .update(persons)
    .set({
      sex,
      updatedAt: new Date(),
    })
    .where(eq(persons.id, personId));
}

/**
 * Update the signed-in account holder's identity fields after onboarding. Does not touch
 * `onboarded_at` — this is for the profile editor, not the welcome gate.
 */
export async function updatePersonIdentity(
  db: Database,
  personId: string,
  input: UpdatePersonIdentityInput,
): Promise<void> {
  const displayName = requireDisplayName(input.displayName);
  const birthDate = validateBirthDate(
    input.year,
    input.month,
    input.day,
    input.now ?? new Date(),
  );

  const spokenNameRaw = input.spokenName?.trim();
  const spokenName =
    spokenNameRaw && spokenNameRaw.length > 0
      ? spokenNameRaw
      : defaultSpokenName(displayName);

  await db
    .update(persons)
    .set({
      displayName,
      spokenName,
      birthDate,
      birthYear: input.year,
      updatedAt: new Date(),
    })
    .where(eq(persons.id, personId));
}
