/**
 * The Ask repository — the self-feeding relay seam (spec Part III, "asked-question loop").
 *
 * Asks are NOT expressive content — they are prompts created by a family member for a narrator, and
 * the table is on the OPEN schema surface (not behind the guarded content subpath). That said,
 * to keep with the spec's "endpoints do not roll their own access logic" discipline (Part II / V),
 * Ask creation and listing route through this module — so the co-membership check that gates who
 * may ask whom lives in ONE place, not duplicated across server actions.
 *
 * Phase 1 scope: create + list-pending. Status flips to `routed` (Increment 7) and `answered`
 * (Increment 7) are wired in I7 — this file deliberately exposes only what I6 needs, so the I7
 * shape is an additive change.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { asks, memberships, persons } from "@chronicle/db/schema";
import type { Ask, AskStatus, Database } from "@chronicle/db";
import { AuthorizationError, InvariantViolation } from "./errors";
import type { AuthContext } from "./authorization";
import { viewerPersonId } from "./authorization";
import { PENDING_ASKS_DEFAULT_LIMIT } from "./constants";

export interface CreateAskInput {
  /** The target narrator the question is for. */
  targetPersonId: string;
  /** The family context the ask is raised in (optional — informs routing/notification). */
  familyId?: string;
  questionText: string;
}

/** Set of family ids the person currently holds an ACTIVE membership in. */
async function activeFamilyIds(
  db: Database,
  personId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(
      and(eq(memberships.personId, personId), eq(memberships.status, "active")),
    );
  return new Set(rows.map((r) => r.familyId));
}

/**
 * Submit an Ask from the viewer to the target narrator. Authorization rule: the asker and the target
 * must share an ACTIVE membership in some family — the same co-membership relation the
 * authorization function uses for family-tier reads. Anonymous viewers cannot create asks.
 *
 * On success the Ask is born `queued`; the interviewer (Increment 7) pulls it on the narrator's next
 * gentle session, frames it warmly with the asker named, and flips it to `routed` then
 * `answered` on approval.
 */
export async function createAsk(
  db: Database,
  ctx: AuthContext,
  input: CreateAskInput,
): Promise<Ask> {
  const asker = viewerPersonId(ctx);
  if (asker === null) {
    throw new AuthorizationError(
      "anonymous viewer cannot create an Ask (a Person identity is required)",
    );
  }
  const question = input.questionText.trim();
  if (question.length === 0) {
    throw new AuthorizationError("question text is required");
  }

  const [askerFamilies, targetFamilies] = await Promise.all([
    activeFamilyIds(db, asker),
    activeFamilyIds(db, input.targetPersonId),
  ]);
  let shared = false;
  for (const fid of askerFamilies) {
    if (targetFamilies.has(fid)) {
      shared = true;
      break;
    }
  }
  if (!shared) {
    throw new AuthorizationError(
      "asker shares no active family membership with the target — cannot route a question",
    );
  }

  // If a family context was supplied, it must be one the asker is actually in. Defense in depth
  // against a hand-crafted form submission picking an arbitrary family id.
  if (input.familyId !== undefined && !askerFamilies.has(input.familyId)) {
    throw new AuthorizationError(
      "supplied familyId is not one the asker is an active member of",
    );
  }

  const [row] = await db
    .insert(asks)
    .values({
      askerPersonId: asker,
      targetPersonId: input.targetPersonId,
      familyId: input.familyId ?? null,
      questionText: question,
      status: "queued",
    })
    .returning();
  return row!;
}

/**
 * Pending asks for a narrator, in arrival order. Used by Increment 7's interviewer to pull the next
 * batch (with the asker named) into the turn loop. System-actor read — no AuthContext, because it
 * is invoked by the interviewer behavior policy, not a viewer-facing surface.
 */
export interface PendingAskForNarrator {
  ask: Ask;
  askerSpokenName: string;
}

/**
 * Mark an Ask as `routed` — called by the interviewer turn loop the moment it consumes the Ask
 * to phrase a turn. The Ask transitions queued → routed (no other input states are legal). This
 * is the seam that closes the relay's first half: the family member's question has reached the
 * narrator's queue and is being asked. Idempotent: re-marking an already-`routed` Ask is a no-op.
 */
export async function markAskRouted(
  db: Database,
  askId: string,
  opts: { now?: Date } = {},
): Promise<Ask> {
  const now = opts.now ?? new Date();
  const [current] = await db
    .select({ status: asks.status })
    .from(asks)
    .where(eq(asks.id, askId))
    .limit(1);
  if (!current) throw new InvariantViolation(`ask not found: ${askId}`);
  if (current.status === "routed") {
    const [row] = await db.select().from(asks).where(eq(asks.id, askId)).limit(1);
    return row!;
  }
  if (current.status !== "queued") {
    throw new InvariantViolation(
      `markAskRouted: ask must be queued (was ${current.status})`,
    );
  }
  const [row] = await db
    .update(asks)
    .set({ status: "routed", routedAt: now, updatedAt: now })
    .where(eq(asks.id, askId))
    .returning();
  return row!;
}

/**
 * Mark an Ask as `answered` and point it at the Story. Called atomically from the approval
 * write when the narrator approves a Story that pointed at an Ask (story.askId). Legal sources are
 * `queued` (the narrator answered without the interviewer pre-routing — e.g. a tight session) and
 * `routed`. Re-marking an already-`answered` Ask with the SAME storyId is idempotent; with a
 * different storyId it is rejected (an Ask answers exactly one Story).
 */
export async function markAskAnswered(
  db: Database,
  askId: string,
  storyId: string,
  opts: { now?: Date } = {},
): Promise<Ask> {
  const now = opts.now ?? new Date();
  const [current] = await db
    .select({ status: asks.status, storyId: asks.storyId })
    .from(asks)
    .where(eq(asks.id, askId))
    .limit(1);
  if (!current) throw new InvariantViolation(`ask not found: ${askId}`);
  if (current.status === "answered") {
    if (current.storyId === storyId) {
      const [row] = await db.select().from(asks).where(eq(asks.id, askId)).limit(1);
      return row!;
    }
    throw new InvariantViolation(
      `markAskAnswered: ask ${askId} already answered by a different story`,
    );
  }
  const [row] = await db
    .update(asks)
    .set({ status: "answered", storyId, answeredAt: now, updatedAt: now })
    .where(eq(asks.id, askId))
    .returning();
  return row!;
}

/**
 * The asker's own submitted Asks, most-recent first, with the target narrator's spoken name and
 * (for answered ones) the resulting story id. Powers the hub notification view — the asker sees
 * their question's status without polling the narrator side.
 */
export interface AskerOwnAsk {
  ask: Ask;
  targetSpokenName: string;
}

export async function listAsksByAsker(
  db: Database,
  ctx: AuthContext,
): Promise<AskerOwnAsk[]> {
  const asker = viewerPersonId(ctx);
  if (asker === null) return [];
  const rows = await db
    .select({ ask: asks, targetSpokenName: persons.spokenName })
    .from(asks)
    .innerJoin(persons, eq(persons.id, asks.targetPersonId))
    .where(eq(asks.askerPersonId, asker))
    .orderBy(desc(asks.createdAt));
  return rows.map((r) => ({ ask: r.ask, targetSpokenName: r.targetSpokenName }));
}

export async function listPendingAsksForNarrator(
  db: Database,
  narratorPersonId: string,
  opts: { limit?: number } = {},
): Promise<PendingAskForNarrator[]> {
  const limit = opts.limit ?? PENDING_ASKS_DEFAULT_LIMIT;
  const rows = await db
    .select({
      ask: asks,
      askerSpokenName: persons.spokenName,
    })
    .from(asks)
    .innerJoin(persons, eq(persons.id, asks.askerPersonId))
    .where(
      and(
        eq(asks.targetPersonId, narratorPersonId),
        inArray(asks.status, ["queued", "routed"] as AskStatus[]),
      ),
    )
    .orderBy(asc(asks.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ask: r.ask, askerSpokenName: r.askerSpokenName }));
}
