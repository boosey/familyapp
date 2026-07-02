/**
 * Join requests — a stranger's approval-gated request to join a discoverable family (ADR-0001).
 *
 * Discovery surfaces a family; it never bypasses steward consent. A discovered family's steward
 * must approve a join request before any membership exists. Approval (and the membership it
 * creates) is one transaction so the request can never read `approved` without the membership
 * having landed.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { families, joinRequests, persons } from "@chronicle/db/schema";
import type { Database, JoinRequestStatus } from "@chronicle/db";
import { DECIDED_JOIN_REQUESTS_DEFAULT_LIMIT } from "./constants";
import { AuthorizationError, InvariantViolation } from "./errors";
import {
  getStewardPersonId,
  insertActiveMembership,
  isActiveMember,
} from "./memberships";

export interface CreateJoinRequestInput {
  familyId: string;
  requesterPersonId: string;
  message?: string;
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505). PGlite surfaces the native
 * Postgres error, so the `code` is reliable; we also fall back to the constraint name in the
 * message for driver wrappers that bury the code.
 */
function isPendingJoinRequestUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23505") return true;
  const message = (err as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    message.includes("join_requests_one_pending_uq")
  );
}

/**
 * Create a pending join request. Guards (each a distinct rejection):
 *   - the family must exist AND be discoverable (`InvariantViolation`);
 *   - the requester must NOT already be an active member (`InvariantViolation`);
 *   - there must be no existing PENDING request from this requester for this family (dedupe).
 *
 * The guards + insert run in one transaction, but the no-duplicate-pending guard cannot rely on
 * the SELECT alone: under READ COMMITTED two concurrent calls both read "no pending" and both
 * insert. The DB-level partial unique index `join_requests_one_pending_uq` is the real guard; the
 * SELECT just turns the common case into a clean message, and the unique-violation catch maps the
 * race loser to the SAME `InvariantViolation`.
 */
export async function createJoinRequest(
  db: Database,
  input: CreateJoinRequestInput,
): Promise<{ joinRequestId: string }> {
  try {
    return await db.transaction(async (tx) => {
      const [family] = await tx
        .select({ id: families.id, discoverable: families.discoverable })
        .from(families)
        .where(eq(families.id, input.familyId))
        .limit(1);
      if (!family) {
        throw new InvariantViolation(`family not found: ${input.familyId}`);
      }
      if (!family.discoverable) {
        throw new InvariantViolation(
          "family is not discoverable — it cannot receive join requests",
        );
      }

      const alreadyMember = await isActiveMember(
        tx,
        input.requesterPersonId,
        input.familyId,
      );
      if (alreadyMember) {
        throw new InvariantViolation(
          "requester is already an active member of this family",
        );
      }

      const [pendingDup] = await tx
        .select({ id: joinRequests.id })
        .from(joinRequests)
        .where(
          and(
            eq(joinRequests.familyId, input.familyId),
            eq(joinRequests.requesterPersonId, input.requesterPersonId),
            eq(joinRequests.status, "pending"),
          ),
        )
        .limit(1);
      if (pendingDup) {
        throw new InvariantViolation(
          "a pending join request from this requester already exists for this family",
        );
      }

      const [row] = await tx
        .insert(joinRequests)
        .values({
          familyId: input.familyId,
          requesterPersonId: input.requesterPersonId,
          message: input.message?.trim() || null,
          status: "pending",
        })
        .returning({ id: joinRequests.id });

      return { joinRequestId: row!.id };
    });
  } catch (err) {
    // The partial unique index fired — a concurrent caller won the pending slot. Same outcome
    // as the SELECT guard above, surfaced as the same domain error.
    if (isPendingJoinRequestUniqueViolation(err)) {
      throw new InvariantViolation(
        "a pending join request from this requester already exists for this family",
      );
    }
    throw err;
  }
}

export interface PendingJoinRequest {
  joinRequestId: string;
  familyId: string;
  familyName: string;
  requesterPersonId: string;
  requesterName: string;
  message: string | null;
  createdAt: Date;
}

/** Every pending request across the families this steward stewards, newest first. */
export async function listPendingJoinRequestsForSteward(
  db: Database,
  stewardPersonId: string,
): Promise<PendingJoinRequest[]> {
  const rows = await db
    .select({
      joinRequestId: joinRequests.id,
      familyId: joinRequests.familyId,
      familyName: families.name,
      requesterPersonId: joinRequests.requesterPersonId,
      requesterName: persons.displayName,
      message: joinRequests.message,
      createdAt: joinRequests.createdAt,
    })
    .from(joinRequests)
    .innerJoin(families, eq(families.id, joinRequests.familyId))
    .innerJoin(persons, eq(persons.id, joinRequests.requesterPersonId))
    .where(
      and(
        eq(families.stewardPersonId, stewardPersonId),
        eq(joinRequests.status, "pending"),
      ),
    )
    .orderBy(desc(joinRequests.createdAt));
  return rows;
}

/** A join request the steward has already decided (approved or declined). */
export interface DecidedJoinRequest {
  joinRequestId: string;
  familyId: string;
  familyName: string;
  requesterPersonId: string;
  requesterName: string;
  message: string | null;
  createdAt: Date;
  status: JoinRequestStatus;
  decidedAt: Date | null;
}

/**
 * Recently-decided (approved/declined) requests across the families this steward stewards, newest
 * decision first. Lets the requests surface show a resolved row in place rather than vanishing it
 * the moment it's decided. Capped so an old family's history can't unbound the list.
 */
export async function listDecidedJoinRequestsForSteward(
  db: Database,
  stewardPersonId: string,
  opts: { limit?: number } = {},
): Promise<DecidedJoinRequest[]> {
  const limit = opts.limit ?? DECIDED_JOIN_REQUESTS_DEFAULT_LIMIT;
  if (limit <= 0) return [];
  const rows = await db
    .select({
      joinRequestId: joinRequests.id,
      familyId: joinRequests.familyId,
      familyName: families.name,
      requesterPersonId: joinRequests.requesterPersonId,
      requesterName: persons.displayName,
      message: joinRequests.message,
      createdAt: joinRequests.createdAt,
      status: joinRequests.status,
      decidedAt: joinRequests.decidedAt,
    })
    .from(joinRequests)
    .innerJoin(families, eq(families.id, joinRequests.familyId))
    .innerJoin(persons, eq(persons.id, joinRequests.requesterPersonId))
    .where(
      and(
        eq(families.stewardPersonId, stewardPersonId),
        ne(joinRequests.status, "pending"),
      ),
    )
    .orderBy(desc(joinRequests.decidedAt))
    .limit(limit);
  return rows;
}

/**
 * Load a still-pending request and verify the decider is its family's steward. Shared by approve +
 * decline. Throws `InvariantViolation` if the request is missing or already decided, and
 * `AuthorizationError` if the decider is not the steward.
 */
async function loadDecidableRequest(
  db: Pick<Database, "select">,
  joinRequestId: string,
  deciderPersonId: string,
): Promise<{ familyId: string; requesterPersonId: string }> {
  const [req] = await db
    .select({
      familyId: joinRequests.familyId,
      requesterPersonId: joinRequests.requesterPersonId,
      status: joinRequests.status,
    })
    .from(joinRequests)
    .where(eq(joinRequests.id, joinRequestId))
    .limit(1);
  if (!req) {
    throw new InvariantViolation(`join request not found: ${joinRequestId}`);
  }
  if (req.status !== "pending") {
    throw new InvariantViolation(
      `join request is ${req.status}, not pending — cannot decide`,
    );
  }
  const stewardPersonId = await getStewardPersonId(db, req.familyId);
  if (stewardPersonId !== deciderPersonId) {
    throw new AuthorizationError(
      "only the family steward may decide a join request",
    );
  }
  return { familyId: req.familyId, requesterPersonId: req.requesterPersonId };
}

/**
 * Approve a join request atomically: re-validate steward + pending inside the tx, create the
 * requester's ACTIVE `member` membership, and flip the request to `approved` (recording decider,
 * time, and the resulting membership id).
 */
export async function approveJoinRequest(
  db: Database,
  args: { joinRequestId: string; deciderPersonId: string },
): Promise<{ membershipId: string }> {
  return db.transaction(async (tx) => {
    const { familyId, requesterPersonId } = await loadDecidableRequest(
      tx,
      args.joinRequestId,
      args.deciderPersonId,
    );
    const { membershipId } = await insertActiveMembership(tx, {
      personId: requesterPersonId,
      familyId,
      role: "member",
    });
    await tx
      .update(joinRequests)
      .set({
        status: "approved",
        decidedByPersonId: args.deciderPersonId,
        decidedAt: new Date(),
        resultingMembershipId: membershipId,
      })
      .where(eq(joinRequests.id, args.joinRequestId));
    return { membershipId };
  });
}

/** Decline a join request (steward-only). No membership is created. */
export async function declineJoinRequest(
  db: Database,
  args: { joinRequestId: string; deciderPersonId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await loadDecidableRequest(tx, args.joinRequestId, args.deciderPersonId);
    await tx
      .update(joinRequests)
      .set({
        status: "declined",
        decidedByPersonId: args.deciderPersonId,
        decidedAt: new Date(),
      })
      .where(eq(joinRequests.id, args.joinRequestId));
  });
}

export interface RequesterJoinRequest {
  joinRequestId: string;
  familyId: string;
  familyName: string;
  /** The steward the request is waiting on — safe to show a requester (their own request). */
  stewardName: string;
  status: JoinRequestStatus;
  createdAt: Date;
}

/** The requester's own join requests, newest first — so they can see pending/decided status. */
export async function listJoinRequestsByRequester(
  db: Database,
  requesterPersonId: string,
): Promise<RequesterJoinRequest[]> {
  const rows = await db
    .select({
      joinRequestId: joinRequests.id,
      familyId: joinRequests.familyId,
      familyName: families.name,
      stewardName: persons.displayName,
      status: joinRequests.status,
      createdAt: joinRequests.createdAt,
    })
    .from(joinRequests)
    .innerJoin(families, eq(families.id, joinRequests.familyId))
    .innerJoin(persons, eq(persons.id, families.stewardPersonId))
    .where(eq(joinRequests.requesterPersonId, requesterPersonId))
    .orderBy(desc(joinRequests.createdAt));
  return rows;
}
