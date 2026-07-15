/**
 * Post-onboarding Person identity edits — name and date of birth.
 *
 * The persons table is on the open schema (identity, not story content), so direct writes are
 * allowed. Validation lives here so profile edits and onboarding share one set of rules.
 */
import { and, eq, inArray } from "drizzle-orm";
import { families, memberships, persons } from "@chronicle/db/schema";
import type { Database, LifeStatus, PersonSex } from "@chronicle/db";
import { AuthorizationError, InvariantViolation } from "./errors";
import { defaultSpokenName } from "./names";
import { validateBirthDate } from "./person-dob";
import { type AuthContext, viewerPersonId } from "./authorization";

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

/**
 * ADR-0021 (tree Slice C) — set the COARSE birth year only, clearing any full `birthDate`. The tree
 * card shows a year, and `addRelative` accepts a bare `birthYear`, so a cross-person editor who knows
 * only the year should not be forced to invent a month/day. Setting a full date is the separate
 * `updatePersonBirthDate` path (self profile editing). A null clears the year.
 */
export async function updatePersonBirthYear(
  db: Database,
  personId: string,
  birthYear: number | null,
): Promise<void> {
  if (birthYear !== null && !Number.isInteger(birthYear)) {
    throw new InvariantViolation(`birth year ${birthYear} is not an integer`);
  }
  await db
    .update(persons)
    .set({
      birthYear,
      // A coarse-year edit invalidates any stored full date (we no longer know it's consistent).
      birthDate: null,
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

// ===========================================================================
// ADR-0021 — cross-person identity editing (tree Slice C).
//
// A viewer may edit a Person who is NOT themselves only under a narrow, audited policy. The policy
// lives in ONE predicate (`canEditPerson`) that BOTH the UI gate and the write choke point consume,
// so they can never diverge. `updatePersonIdentityAsEditor` is the single non-self write path: it
// re-checks the predicate and throws before touching a row.
// ===========================================================================

/** The lifeStatus + death-field setters the editor path composes (mirrors the DOB/sex setters). */
export async function updatePersonLifeStatus(
  db: Database,
  personId: string,
  input: {
    lifeStatus: LifeStatus;
    /** Coarse year of death; ignored (NULLed) when lifeStatus is "living" (ADR-0016 tree renderer). */
    deathYear?: number | null;
    /** Full date of death "YYYY-MM-DD"; ignored (NULLed) when lifeStatus is "living". */
    deathDate?: string | null;
  },
): Promise<void> {
  // Death fields are meaningful only for a deceased Person: NULL them for the living so a stale/forged
  // death year can never persist on a living node (same discipline as insertMentionPerson).
  const deceased = input.lifeStatus === "deceased";
  await db
    .update(persons)
    .set({
      lifeStatus: input.lifeStatus,
      deathYear: deceased ? (input.deathYear ?? null) : null,
      deathDate: deceased ? (input.deathDate ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(persons.id, personId));
}

/** The reason a viewer is allowed to edit a person, in precedence order. `null` ⇒ not allowed. */
export type EditPersonReason = "self" | "creator" | "steward" | "deceased-family";

export interface EditPersonDecision {
  allowed: boolean;
  reason: EditPersonReason | null;
}

const NOT_ALLOWED: EditPersonDecision = { allowed: false, reason: null };

/** Family ids in which `personId` currently holds an ACTIVE membership. */
async function activeFamilyIdsOf(db: Database, personId: string): Promise<string[]> {
  const rows = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(and(eq(memberships.personId, personId), eq(memberships.status, "active")));
  return rows.map((r) => r.familyId);
}

/**
 * ADR-0021 — MAY the viewer edit this Person's identity fields? THE single predicate; the UI gate
 * (a server-projected `editable` flag) and the write guard (`updatePersonIdentityAsEditor`) both call
 * it so they can never diverge. Precedence (first match wins): self → creator → steward →
 * deceased-family. Anonymous / non-member viewers, and living non-self persons without a
 * creator/steward tie, are denied.
 *
 * The person must exist (a missing/unknown personId is denied). Only reads memberships + families +
 * the person row; never widens the content front door.
 */
export async function canEditPerson(
  db: Database,
  ctx: AuthContext,
  personId: string,
): Promise<EditPersonDecision> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) return NOT_ALLOWED; // anonymous can never edit

  const [person] = await db
    .select({
      id: persons.id,
      lifeStatus: persons.lifeStatus,
      createdByPersonId: persons.createdByPersonId,
    })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  if (person === undefined) return NOT_ALLOWED; // unknown person

  // 1. Self — the viewer editing their own record.
  if (viewer === person.id) return { allowed: true, reason: "self" };

  // 2. Creator — the viewer minted this record (immutable provenance).
  if (person.createdByPersonId !== null && person.createdByPersonId === viewer) {
    return { allowed: true, reason: "creator" };
  }

  // The person's active families gate both the steward arm and the deceased-family arm.
  const personFamilies = await activeFamilyIdsOf(db, personId);
  if (personFamilies.length > 0) {
    // 3. Steward — the viewer is the steward of a family the person actively belongs to.
    const stewardRows = await db
      .select({ familyId: families.id })
      .from(families)
      .where(
        and(
          inArray(families.id, personFamilies),
          eq(families.stewardPersonId, viewer),
        ),
      );
    if (stewardRows.length > 0) return { allowed: true, reason: "steward" };

    // 4. Deceased → any active family member — a viewer sharing an active membership with a DECEASED
    //    person may edit (collaborative ancestor maintenance). Living non-self persons never qualify.
    if (person.lifeStatus === "deceased") {
      const viewerFamilies = new Set(await activeFamilyIdsOf(db, viewer));
      if (personFamilies.some((f) => viewerFamilies.has(f))) {
        return { allowed: true, reason: "deceased-family" };
      }
    }
  }

  return NOT_ALLOWED;
}

/**
 * ADR-0021 — the patch a non-self editor may apply. Every field is OPTIONAL (partial edit); a field
 * that is `undefined` is left untouched. `spokenName` is a narrator concept and is honored ONLY when
 * the editor is editing THEIR OWN record (self); a non-self editor supplying it is ignored.
 */
export interface EditPersonPatch {
  /** Trimmed non-empty sets the name and (if the person was an unidentified mention) flips `identified`
   *  true. A whitespace-only value is rejected; omit the field to leave the name unchanged. */
  displayName?: string;
  /**
   * Birth date. Two mutually-exclusive shapes (the tree only shows a coarse year, so year-only is the
   * common cross-person edit):
   *   - `birthYear` alone → sets the coarse year, clears any full `birthDate` (via updatePersonBirthYear).
   *   - `birthYear` + `birthMonth` + `birthDay` together → a validated full date (updatePersonBirthDate).
   * Supplying month/day WITHOUT the year (or a partial m/d) is rejected. A `birthYear: null` clears it.
   */
  birthYear?: number | null;
  birthMonth?: number;
  birthDay?: number;
  /** Life status + (deceased-only) death fields. */
  lifeStatus?: LifeStatus;
  deathYear?: number | null;
  deathDate?: string | null;
  sex?: PersonSex;
  /** Self-only (narrator concept). Ignored for a non-self editor. */
  spokenName?: string;
  now?: Date;
}

/**
 * ADR-0021 — THE single write choke point for identity edits (self OR cross-person). Re-checks
 * `canEditPerson` FIRST and throws `AuthorizationError` when not allowed — so a disallowed editor is
 * rejected even when this is called directly, not merely UI-hidden. Reuses the field-level setters so
 * validation stays in one place. Naming a previously-unidentified `mention` flips `identified` true
 * (ADR-0016/0017: filling the name promotes a placeholder to a real card; origin unchanged).
 */
export async function updatePersonIdentityAsEditor(
  db: Database,
  ctx: AuthContext,
  personId: string,
  patch: EditPersonPatch,
): Promise<void> {
  const decision = await canEditPerson(db, ctx, personId);
  if (!decision.allowed) {
    throw new AuthorizationError(
      "viewer is not permitted to edit this person's identity",
    );
  }
  const isSelf = decision.reason === "self";

  // displayName — trimmed non-empty sets the name; naming an unidentified mention flips `identified`.
  if (patch.displayName !== undefined) {
    const displayName = requireDisplayName(patch.displayName);
    const set: {
      displayName: string;
      identified: boolean;
      updatedAt: Date;
      spokenName?: string;
    } = { displayName, identified: true, updatedAt: new Date() };
    // A non-self editor never sets spokenName. Self may (or it re-derives from the name below).
    if (isSelf) {
      const spokenRaw = patch.spokenName?.trim();
      set.spokenName =
        spokenRaw && spokenRaw.length > 0 ? spokenRaw : defaultSpokenName(displayName);
    }
    await db.update(persons).set(set).where(eq(persons.id, personId));
  } else if (isSelf && patch.spokenName !== undefined) {
    // Self editing spokenName WITHOUT a name change.
    await updatePersonSpokenName(db, personId, patch.spokenName);
  }

  // Birth date — either a full validated date (y+m+d) OR a coarse year only (the tree's grain).
  const hasMonth = patch.birthMonth !== undefined;
  const hasDay = patch.birthDay !== undefined;
  if (patch.birthYear !== undefined || hasMonth || hasDay) {
    if (hasMonth || hasDay) {
      // Full-date shape: all three parts required together.
      if (patch.birthYear === undefined || patch.birthYear === null || !hasMonth || !hasDay) {
        throw new InvariantViolation(
          "a full birth date requires year, month, and day together",
        );
      }
      await updatePersonBirthDate(db, personId, {
        year: patch.birthYear,
        month: patch.birthMonth!,
        day: patch.birthDay!,
        now: patch.now,
      });
    } else {
      // Year-only shape (may be null to clear).
      await updatePersonBirthYear(db, personId, patch.birthYear ?? null);
    }
  }

  // Sex.
  if (patch.sex !== undefined) {
    await updatePersonSex(db, personId, patch.sex);
  }

  // Life status (+ death fields for the deceased).
  if (patch.lifeStatus !== undefined) {
    await updatePersonLifeStatus(db, personId, {
      lifeStatus: patch.lifeStatus,
      deathYear: patch.deathYear ?? null,
      deathDate: patch.deathDate ?? null,
    });
  }
}
