/**
 * Families (Chronicles) — the container that owns NOTHING expressive (spec Part II).
 *
 * Creating a family is two writes that must not half-land: the `families` row (creator IS steward
 * in Phase 0) and the creator's ACTIVE `steward` membership. They go in one transaction so a
 * family never exists without its steward being a member. Discovery is steward-only — a stranger's
 * search only ever surfaces families whose steward opted in (`setFamilyDiscovery`).
 */
import { eq } from "drizzle-orm";
import { families } from "@chronicle/db/schema";
import type { Database, Family } from "@chronicle/db";
import { AuthorizationError, InvariantViolation } from "./errors";
import { insertActiveMembership } from "./memberships";

export interface CreateFamilyInput {
  name: string;
  /** Optional steward-set brief label (ADR-0021 "Short name (Family)"); falls back to `name` when unset. */
  shortName?: string;
  description?: string;
  discoverable?: boolean;
  creatorPersonId: string;
}

export interface CreateFamilyResult {
  familyId: string;
  membershipId: string;
}

/**
 * Create a family atomically: the creator becomes both `creator_person_id` and `steward_person_id`
 * and receives an ACTIVE `steward` membership. Returns the new family + membership ids. An optional
 * `shortName` (ADR-0021) is persisted trimmed, or null when blank/omitted (falls back to `name`).
 */
export async function createFamily(
  db: Database,
  input: CreateFamilyInput,
): Promise<CreateFamilyResult> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new InvariantViolation("family name is required");
  }

  return db.transaction(async (tx) => {
    const [family] = await tx
      .insert(families)
      .values({
        name,
        shortName: input.shortName?.trim() || null,
        description: input.description?.trim() || null,
        discoverable: input.discoverable ?? false,
        creatorPersonId: input.creatorPersonId,
        stewardPersonId: input.creatorPersonId,
      })
      .returning();

    const { membershipId } = await insertActiveMembership(tx, {
      personId: input.creatorPersonId,
      familyId: family!.id,
      role: "steward",
    });

    return { familyId: family!.id, membershipId };
  });
}

export interface UpdateFamilyInput {
  familyId: string;
  actorPersonId: string;
  name: string;
  shortName?: string | null;
  description?: string | null;
  discoverable: boolean;
}

/**
 * Steward-only edit of a family's mutable metadata (ADR-0021 Edit-a-Family, #54). Families are
 * mutable metadata — no append-only ledger — so this is a plain UPDATE. Re-checks stewardship
 * server-side INSIDE the transaction (defence in depth: the route guards too): a non-steward is
 * rejected with AuthorizationError, a missing family with InvariantViolation. `name` is required
 * (trimmed, non-empty); `shortName`/`description` are trimmed-or-null (blank clears them).
 */
export async function updateFamily(db: Database, input: UpdateFamilyInput): Promise<void> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new InvariantViolation("family name is required");
  }
  await db.transaction(async (tx) => {
    const [family] = await tx
      .select({ stewardPersonId: families.stewardPersonId })
      .from(families)
      .where(eq(families.id, input.familyId))
      .limit(1);
    if (!family) {
      throw new InvariantViolation(`family not found: ${input.familyId}`);
    }
    if (family.stewardPersonId !== input.actorPersonId) {
      throw new AuthorizationError("only the family steward may edit the family");
    }
    await tx
      .update(families)
      .set({
        name,
        shortName: input.shortName?.trim() || null,
        description: input.description?.trim() || null,
        discoverable: input.discoverable,
      })
      .where(eq(families.id, input.familyId));
  });
}

export interface StewardedFamilyView {
  familyId: string;
  name: string;
  shortName: string | null;
}

/**
 * The families for which `personId` is the steward — used to surface the steward-only Edit-a-Family
 * entry point in the account menu (#54). Sorted by name then id for a stable menu order.
 */
export async function listFamiliesStewardedBy(
  db: Database,
  personId: string,
): Promise<StewardedFamilyView[]> {
  const rows = await db
    .select({ familyId: families.id, name: families.name, shortName: families.shortName })
    .from(families)
    .where(eq(families.stewardPersonId, personId));
  return rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.familyId < b.familyId ? -1 : a.familyId > b.familyId ? 1 : 0),
  );
}

export async function getFamily(
  db: Database,
  familyId: string,
): Promise<Family | null> {
  const [row] = await db
    .select()
    .from(families)
    .where(eq(families.id, familyId))
    .limit(1);
  return row ?? null;
}

/**
 * Update a family's discovery opt-in (and, optionally, its description). Steward-only: a non-steward
 * actor is rejected with `AuthorizationError`. The description edit is folded in here because the
 * discovery screen is where a steward writes the searchable blurb.
 */
export async function setFamilyDiscovery(
  db: Database,
  args: {
    familyId: string;
    actorPersonId: string;
    discoverable: boolean;
    description?: string;
  },
): Promise<void> {
  // One tx so the steward check and the update see a consistent snapshot (matches the rest of
  // the codebase's write discipline).
  await db.transaction(async (tx) => {
    const [family] = await tx
      .select({ stewardPersonId: families.stewardPersonId })
      .from(families)
      .where(eq(families.id, args.familyId))
      .limit(1);
    if (!family) {
      throw new InvariantViolation(`family not found: ${args.familyId}`);
    }
    if (family.stewardPersonId !== args.actorPersonId) {
      throw new AuthorizationError(
        "only the family steward may change discovery settings",
      );
    }
    await tx
      .update(families)
      .set({
        discoverable: args.discoverable,
        ...(args.description !== undefined
          ? { description: args.description.trim() || null }
          : {}),
      })
      .where(eq(families.id, args.familyId));
  });
}
