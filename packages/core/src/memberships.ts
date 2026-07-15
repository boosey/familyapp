/**
 * Memberships — the plural, revocable link between a Person and a Family (spec Part II).
 *
 * A membership carries role + status and is the input to every permission check. The load-bearing
 * invariant here is the partial unique index "at most one ACTIVE membership per (person, family)"
 * (added in the triggers migration). This module is the single place that respects it on the write
 * side, so the same guard is reused by invitation-accept and join-request-approve rather than each
 * rolling its own check.
 */
import { and, eq } from "drizzle-orm";
import { families, memberships, persons } from "@chronicle/db/schema";
import type { Database, Membership, MembershipRole } from "@chronicle/db";
import { InvariantViolation } from "./errors";

/**
 * A handle that is either the pooled client or an open transaction. The membership insert is reused
 * inside the invitation-accept / join-request-approve transactions, so the helper must accept a tx.
 */
type DbOrTx = Pick<Database, "select" | "insert">;

/**
 * Insert an ACTIVE membership, honoring the at-most-one-active-(person, family) index. Shared by
 * `addMembership` and the accept/approve write paths so the guard lives in one place. If an active
 * membership already exists -> `InvariantViolation`. An ENDED/PAUSED row does not block a rejoin —
 * a new active row is inserted (the DB permits it; the partial index only constrains active rows).
 */
export async function insertActiveMembership(
  db: DbOrTx,
  input: { personId: string; familyId: string; role?: MembershipRole },
): Promise<{ membershipId: string }> {
  const [existing] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.personId, input.personId),
        eq(memberships.familyId, input.familyId),
        eq(memberships.status, "active"),
      ),
    )
    .limit(1);
  if (existing) {
    throw new InvariantViolation(
      `person ${input.personId} already has an active membership in family ${input.familyId}`,
    );
  }
  const [row] = await db
    .insert(memberships)
    .values({
      personId: input.personId,
      familyId: input.familyId,
      role: input.role ?? "member",
      status: "active",
    })
    .returning({ id: memberships.id });
  return { membershipId: row!.id };
}

/** Public entry: add an ACTIVE membership (defaults to `member`). */
export async function addMembership(
  db: Database,
  input: { personId: string; familyId: string; role?: MembershipRole },
): Promise<{ membershipId: string }> {
  return insertActiveMembership(db, input);
}

export async function listActiveMembershipsForPerson(
  db: Database,
  personId: string,
): Promise<Membership[]> {
  return db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.personId, personId), eq(memberships.status, "active")),
    );
}

export async function isActiveMember(
  db: Pick<Database, "select">,
  personId: string,
  familyId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.personId, personId),
        eq(memberships.familyId, familyId),
        eq(memberships.status, "active"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The family's steward Person id, or null if the family does not exist. */
export async function getStewardPersonId(
  db: Pick<Database, "select">,
  familyId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ stewardPersonId: families.stewardPersonId })
    .from(families)
    .where(eq(families.id, familyId))
    .limit(1);
  return row?.stewardPersonId ?? null;
}

export interface ActiveFamilyView {
  familyId: string;
  familyName: string;
  /** The steward-set brief label (ADR-0021), shown in the chip UIs where the formal name crowds the
   *  layout. Null when unset — callers fall back to `familyName`. */
  familyShortName: string | null;
}

/**
 * The families in which `personId` holds an ACTIVE membership, with names, sorted by name then id.
 * The album picker (#16) and the album page's family switcher default to the current family context
 * and re-derive the allowed set from THIS list — a client-submitted family id is never trusted.
 */
export async function listActiveFamiliesForPerson(
  db: Database,
  personId: string,
): Promise<ActiveFamilyView[]> {
  const rows = await db
    .select({
      familyId: memberships.familyId,
      familyName: families.name,
      familyShortName: families.shortName,
    })
    .from(memberships)
    .innerJoin(families, eq(families.id, memberships.familyId))
    .where(
      and(eq(memberships.personId, personId), eq(memberships.status, "active")),
    );
  return rows.sort(
    (a, b) =>
      a.familyName.localeCompare(b.familyName) ||
      (a.familyId < b.familyId ? -1 : a.familyId > b.familyId ? 1 : 0),
  );
}

export interface FamilyMemberView {
  personId: string;
  displayName: string;
  role: MembershipRole;
}

/** Active members of a family, with display name + role. */
export async function listMembersOfFamily(
  db: Database,
  familyId: string,
): Promise<FamilyMemberView[]> {
  const rows = await db
    .select({
      personId: persons.id,
      displayName: persons.displayName,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(
      and(eq(memberships.familyId, familyId), eq(memberships.status, "active")),
    );
  // Members are named self/invitee persons; displayName is nullable only for placeholder mentions
  // (ADR-0016), which never hold a membership. `?? ""` is a compiler guard.
  return rows.map((r) => ({ ...r, displayName: r.displayName ?? "" }));
}
