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
 * and receives an ACTIVE `steward` membership. Returns the new family + membership ids.
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
