/**
 * The Ask repository — the self-feeding relay seam (spec Part III, "asked-question loop").
 *
 * Asks are NOT expressive content — they are prompts created by a family member for an elder, and
 * the table is on the OPEN schema surface (not behind the guarded content subpath). That said,
 * to keep with the spec's "endpoints do not roll their own access logic" discipline (Part II / V),
 * Ask creation and listing route through this module — so the co-membership check that gates who
 * may ask whom lives in ONE place, not duplicated across server actions.
 *
 * Phase 1 scope: create + list-pending. Status flips to `routed` (Increment 7) and `answered`
 * (Increment 7) are wired in I7 — this file deliberately exposes only what I6 needs, so the I7
 * shape is an additive change.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { asks, memberships, persons } from "@chronicle/db/schema";
import type { Ask, AskStatus, Database } from "@chronicle/db";
import { AuthorizationError } from "./errors";
import type { AuthContext } from "./authorization";
import { viewerPersonId } from "./authorization";

export interface CreateAskInput {
  /** The target elder the question is for. */
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
 * Submit an Ask from the viewer to the target elder. Authorization rule: the asker and the target
 * must share an ACTIVE membership in some family — the same co-membership relation the
 * authorization function uses for family-tier reads. Anonymous viewers cannot create asks.
 *
 * On success the Ask is born `queued`; the interviewer (Increment 7) pulls it on the elder's next
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
 * Pending asks for an elder, in arrival order. Used by Increment 7's interviewer to pull the next
 * batch (with the asker named) into the turn loop. System-actor read — no AuthContext, because it
 * is invoked by the interviewer behavior policy, not a viewer-facing surface.
 */
export interface PendingAskForElder {
  ask: Ask;
  askerSpokenName: string;
}

export async function listPendingAsksForElder(
  db: Database,
  elderPersonId: string,
  opts: { limit?: number } = {},
): Promise<PendingAskForElder[]> {
  const limit = opts.limit ?? 20;
  const rows = await db
    .select({
      ask: asks,
      askerSpokenName: persons.spokenName,
    })
    .from(asks)
    .innerJoin(persons, eq(persons.id, asks.askerPersonId))
    .where(
      and(
        eq(asks.targetPersonId, elderPersonId),
        inArray(asks.status, ["queued", "routed"] as AskStatus[]),
      ),
    )
    .orderBy(asc(asks.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ask: r.ask, askerSpokenName: r.askerSpokenName }));
}
