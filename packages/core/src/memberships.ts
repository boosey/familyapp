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
import { AuthorizationError, InvariantViolation } from "./errors";
import { viewerPersonId, type AuthContext } from "./authorization";

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

/**
 * Designate an EXISTING active member as the family's narrator by setting their active membership's
 * role to `narrator` (issue #79 — a relative sets a narrator up before handing off the capture link).
 *
 * Narrow on purpose: it edits the role of the ONE active (person, family) membership — never inserts a
 * row, never resurrects an ENDED/PAUSED one, never mints a Person (creating a brand-new person is
 * `addRelative`'s job, deliberately out of scope here). A person with no active membership in the
 * family cannot be made its narrator → `AuthorizationError` (mirrors createLinkSession's gate: you may
 * only designate someone who already belongs). Idempotent: designating an already-narrator member
 * matches the same active row and is a no-op success — never an error.
 */
export async function designateNarrator(
  db: Pick<Database, "update">,
  input: { personId: string; familyId: string },
): Promise<void> {
  const updated = await db
    .update(memberships)
    .set({ role: "narrator" })
    .where(
      and(
        eq(memberships.personId, input.personId),
        eq(memberships.familyId, input.familyId),
        eq(memberships.status, "active"),
      ),
    )
    .returning({ id: memberships.id });
  if (updated.length === 0) {
    throw new AuthorizationError(
      "cannot designate a narrator: the person has no active membership in this family",
    );
  }
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

// ---------------------------------------------------------------------------
// Member curation (#161, ADR-0023) — mark a member "non-family" (exclude from
// the unplaced set) and end a membership (steward-only removal).
// ---------------------------------------------------------------------------

export interface SetMemberNonFamilyInput {
  familyId: string;
  personId: string;
  nonFamily: boolean;
}

/**
 * Set the `non_family` flag on `personId`'s ACTIVE membership in `familyId` (#161, ADR-0023). Any
 * active member of the family may curate this — deciding a member is not (yet) a tree node is
 * low-stakes and reversible, so it is NOT steward-gated (unlike `endMembership`). `true` removes the
 * member from `listUnplacedMembers`; `false` restores them. A no-op if the person holds no active
 * membership in the family (the WHERE matches nothing) — never an error, mirroring the idempotent
 * curation intent. `persons` are global rows, so this is scoped by (person, family, status=active).
 */
export async function setMemberNonFamily(
  db: Pick<Database, "select" | "update">,
  ctx: AuthContext,
  input: SetMemberNonFamilyInput,
): Promise<void> {
  const actor = viewerPersonId(ctx);
  if (actor === null || !(await isActiveMember(db, actor, input.familyId))) {
    throw new AuthorizationError(
      "only an active member of this family may curate membership placement",
    );
  }
  await db
    .update(memberships)
    .set({ nonFamily: input.nonFamily, updatedAt: new Date() })
    .where(
      and(
        eq(memberships.personId, input.personId),
        eq(memberships.familyId, input.familyId),
        eq(memberships.status, "active"),
      ),
    );
}

export interface EndMembershipInput {
  familyId: string;
  personId: string;
}

/**
 * End `personId`'s ACTIVE membership in `familyId` (#161, ADR-0023) — STEWARD-ONLY. Sets
 * `status='ended'` + `ended_at=now` on the active row (append-only in spirit: a rejoin is a NEW
 * active row, honoring the at-most-one-active index). Access revocation is automatic — the
 * authorization front door and every kinship read gate on `status='active'`, so an ended member
 * immediately loses family content + tree visibility. Authored stories and asserted kinship edges
 * are UNTOUCHED (they survive the person leaving; ADR-0016 kinship is append-only anyway). A no-op
 * WHERE-match (no active membership) still succeeds — ending a non-member is vacuously done.
 */
export async function endMembership(
  db: Pick<Database, "select" | "update">,
  ctx: AuthContext,
  input: EndMembershipInput,
): Promise<void> {
  const actor = viewerPersonId(ctx);
  if (actor === null) {
    throw new AuthorizationError("not signed in");
  }
  const steward = await getStewardPersonId(db, input.familyId);
  if (steward === null) {
    throw new AuthorizationError("family not found");
  }
  if (steward !== actor) {
    throw new AuthorizationError(
      "only the family steward may remove a member",
    );
  }
  // The steward cannot remove THEMSELVES — that would leave the family stewardless (nobody could
  // govern edges or remove members). Steward handoff is a separate, deliberate operation (out of
  // scope here). Guard it so the one remaining governor can never accidentally strand the family.
  if (input.personId === steward) {
    throw new AuthorizationError(
      "the family steward cannot remove their own membership (hand off stewardship first)",
    );
  }
  await db
    .update(memberships)
    .set({ status: "ended", endedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(memberships.personId, input.personId),
        eq(memberships.familyId, input.familyId),
        eq(memberships.status, "active"),
      ),
    );
}
