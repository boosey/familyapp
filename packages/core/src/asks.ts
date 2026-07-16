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
import {
  askFamilies,
  askSubjectPhotos,
  asks,
  invitations,
  memberships,
  persons,
} from "@chronicle/db/schema";
import type { Ask, AskStatus, Database } from "@chronicle/db";
import { AuthorizationError, InvariantViolation } from "./errors";
import type { AuthContext } from "./authorization";
import { getStoryForViewer, viewerPersonId } from "./authorization";
import { assertPersonCanAccessAlbumPhoto } from "./album-repository";
import { PENDING_ASKS_DEFAULT_LIMIT } from "./constants";

export interface CreateAskInput {
  /** The target narrator the question is for. */
  targetPersonId: string;
  /**
   * The family context(s) the ask is raised in (optional — informs routing/notification). An ask
   * may target one-or-more families (ADR-0010 mirror of story targeting); each MUST be one the asker
   * is an active member of. Rows go into the OPEN `ask_families` join, deduped. Absent/empty ⇒ an
   * ask with no family context.
   */
  familyIds?: string[];
  questionText: string;
  /**
   * Album photos the Ask is ABOUT (ADR-0009 Phase 3 "subject") — "tell the story of THIS photo",
   * one or more. Each MUST be visible to BOTH the asker AND the target (gate enforced against both in
   * the same tx); rows go into the OPEN `ask_subject_photos` set, deduped. An ask about a photo the
   * recipient cannot see is meaningless — the answer flow (Slice B) carries the subject photo forward
   * onto the resulting Story gated against the ANSWERER (target), so a target-invisible photo would
   * make the ask unanswerable. Absent/empty ⇒ a plain question with no subject.
   */
  subjectPhotoIds?: string[];
  /**
   * The already-published Story this ask is a FOLLOW-UP on (#77). When set, the ask is a further
   * question sprung from reading a shared story; it is stamped onto `asks.source_story_id` so the
   * narrator's next session can reference where the question came from. The asker MUST be able to
   * SEE this story — the front-door `getStoryForViewer` gate runs in `createAsk` — so a follow-up
   * never leaks the existence of a story the asker could not otherwise read. Absent ⇒ a cold ask.
   */
  sourceStoryId?: string;
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
 * True if `targetPersonId` is a PENDING invitee of any family in `familyIds`. This is the ADR-0006
 * "invitation floor": you may ask someone your family has invited before they join — the invitation
 * anchors to a provisional Person that later merges into their real one.
 *
 * Deliberately `pending`-only. Once an invite is ACCEPTED the invitee is either an active co-member
 * (already covered by the co-membership branch) or a former member whose membership has ended — and
 * in the latter case the divorce/leave semantics must revoke ask rights, so an accepted invitation
 * must NOT keep granting them. Matching `accepted` here would both duplicate the co-membership check
 * and silently re-grant access to people who have left the family.
 */
async function isPendingInviteeOfAnyFamily(
  db: Database,
  targetPersonId: string,
  familyIds: Set<string>,
): Promise<boolean> {
  if (familyIds.size === 0) return false;
  const [row] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        inArray(invitations.familyId, [...familyIds]),
        eq(invitations.status, "pending"),
        eq(invitations.inviteePersonId, targetPersonId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Submit an Ask from the viewer to the target narrator. Authorization rule (ADR-0006): the asker may
 * ask someone they share an ACTIVE membership with, OR someone their family has invited (pending or
 * accepted) — the "invitation floor". The co-membership branch mirrors the family-tier read rule; the
 * invitation branch lets curiosity accumulate against a pending invitee before they join, becoming
 * the warm hook that pulls them in. Anonymous viewers cannot create asks.
 *
 * On success the Ask is born `queued`; the interviewer (Increment 7) pulls it on the narrator's next
 * gentle session, frames it warmly with the asker named, and flips it to `routed` then
 * `answered` on approval.
 *
 * When subject photos (ADR-0009 Phase 3) are supplied, each must be visible to BOTH the asker AND
 * the target — an ask about a photo the recipient cannot see is meaningless and is rejected. Both
 * gates run in the same tx, so a rejected photo leaves NO ask behind.
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
  // Fall back to the ADR-0006 invitation floor: the target may be a pending invitee of one of the
  // asker's active families even without a shared active membership yet.
  if (!shared) {
    shared = await isPendingInviteeOfAnyFamily(db, input.targetPersonId, askerFamilies);
  }
  if (!shared) {
    throw new AuthorizationError(
      "asker shares no active family membership or invitation with the target — cannot route a question",
    );
  }

  // If family context(s) were supplied, each must be one the asker is actually in. Defense in depth
  // against a hand-crafted form submission picking an arbitrary family id. Deduped so a repeated id
  // does not produce duplicate join rows (the unique index would reject those anyway).
  const familyIds = [...new Set(input.familyIds ?? [])];
  for (const familyId of familyIds) {
    if (!askerFamilies.has(familyId)) {
      throw new AuthorizationError(
        "supplied familyId is not one the asker is an active member of",
      );
    }
  }

  // Subject photos (ADR-0009 Phase 3), deduped. Each must be visible to BOTH the asker AND the
  // target — the consolidated album-access gate is the choke point that (a) prevents an asker from
  // targeting a photo they cannot see, and (b) guarantees the target can actually answer: the answer
  // flow carries the subject photo forward gated against the ANSWERER (target), so a target-invisible
  // photo would make the ask unanswerable. Gating both here makes the carry-forward safe by
  // construction. The ask + its subject rows are written in ONE tx, so a rejected photo leaves NO
  // ask behind. (Accepted residual: a membership could END between ask creation and answer; we do
  // not defend against that window this slice.)
  const subjectPhotoIds = [...new Set(input.subjectPhotoIds ?? [])];

  // Follow-up on a published story (#77): the asker MUST be able to SEE the source story. This routes
  // through the single front door (`getStoryForViewer` applies the full state + consent-ledger gate),
  // so a follow-up can never be posed on — and can never leak the existence of — a story the asker
  // could not already read. A missing/unreadable story rejects the whole ask before any row is written.
  if (input.sourceStoryId) {
    const source = await getStoryForViewer(db, ctx, input.sourceStoryId);
    if (source === null) {
      throw new AuthorizationError(
        "cannot pose a follow-up on a story the asker cannot see",
      );
    }
  }

  return db.transaction(async (tx) => {
    for (const photoId of subjectPhotoIds) {
      await assertPersonCanAccessAlbumPhoto(tx, asker, photoId);
      await assertPersonCanAccessAlbumPhoto(tx, input.targetPersonId, photoId);
    }
    const [row] = await tx
      .insert(asks)
      .values({
        askerPersonId: asker,
        targetPersonId: input.targetPersonId,
        questionText: question,
        status: "queued",
        sourceStoryId: input.sourceStoryId ?? null,
      })
      .returning();
    if (familyIds.length > 0) {
      await tx
        .insert(askFamilies)
        .values(familyIds.map((familyId) => ({ askId: row!.id, familyId })));
    }
    if (subjectPhotoIds.length > 0) {
      await tx
        .insert(askSubjectPhotos)
        .values(subjectPhotoIds.map((photoId) => ({ askId: row!.id, photoId })));
    }
    return row!;
  });
}

/**
 * The photo ids an Ask is ABOUT (ADR-0009 Phase 3 "subject"), in deterministic `seq` order. The answer flow
 * (Slice B) reads this to carry the photos forward onto the resulting Story (first ⇒ subject/cover,
 * the rest ⇒ accompaniment). A system-actor read on the OPEN `ask_subject_photos` set — it returns
 * only photo ids, not bytes; visibility of those bytes rides on album membership (see the table's
 * ADR-comment), which the answerer (target co-member) holds.
 */
export async function listAskSubjectPhotos(
  db: Database,
  askId: string,
): Promise<string[]> {
  const rows = await db
    .select({ photoId: askSubjectPhotos.photoId })
    .from(askSubjectPhotos)
    .where(eq(askSubjectPhotos.askId, askId))
    // Order by the monotonic `seq`, NOT `added_at`: all rows of a single bulk insert share the same
    // transaction-start `added_at`, so only `seq` gives a deterministic, insertion-consistent order.
    .orderBy(asc(askSubjectPhotos.seq));
  return rows.map((r) => r.photoId);
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
  /**
   * The family ids this ask is linked to via the OPEN `ask_families` join (ADR-0010), in no
   * particular order. Always present — an ask with no family context carries `[]`. The hub's Asks
   * "Family designator" (ADR-0021) filters the already-authorized list by these ids client-side.
   * NOTE: this list is UNAFFECTED by the `opts.familyId` scope — even when the query is narrowed to
   * one family, each returned ask reports ALL of its family links, so a multi-family ask is labeled
   * completely and the designator can reason about it without a refetch.
   */
  familyIds: string[];
}

export async function listAsksByAsker(
  db: Database,
  ctx: AuthContext,
  opts: { familyId?: string } = {},
): Promise<AskerOwnAsk[]> {
  const asker = viewerPersonId(ctx);
  if (asker === null) return [];

  // Scoped to a single family (the hub's `?scope=`): restrict to asks linked to that family via the
  // OPEN `ask_families` join (ADR-0010). An ask can carry several family rows, but filtering the join
  // to ONE family id yields at most one matching row per ask (composite PK (ask_id, family_id)), so
  // the result is already distinct by ask id — no extra dedup needed.
  let baseRows: { ask: Ask; targetSpokenName: string | null }[];
  if (opts.familyId) {
    baseRows = await db
      .select({ ask: asks, targetSpokenName: persons.spokenName })
      .from(asks)
      .innerJoin(persons, eq(persons.id, asks.targetPersonId))
      .innerJoin(askFamilies, eq(askFamilies.askId, asks.id))
      .where(and(eq(asks.askerPersonId, asker), eq(askFamilies.familyId, opts.familyId)))
      .orderBy(desc(asks.createdAt));
  } else {
    baseRows = await db
      .select({ ask: asks, targetSpokenName: persons.spokenName })
      .from(asks)
      .innerJoin(persons, eq(persons.id, asks.targetPersonId))
      .where(eq(asks.askerPersonId, asker))
      .orderBy(desc(asks.createdAt));
  }

  // Attach EVERY family link per ask (independent of any `opts.familyId` narrowing above) via one
  // grouped read of the OPEN `ask_families` join. Family-less asks simply have no rows here → `[]`.
  const askIds = baseRows.map((r) => r.ask.id);
  const familyIdsByAsk = new Map<string, string[]>();
  if (askIds.length > 0) {
    const famRows = await db
      .select({ askId: askFamilies.askId, familyId: askFamilies.familyId })
      .from(askFamilies)
      .where(inArray(askFamilies.askId, askIds));
    for (const row of famRows) {
      const list = familyIdsByAsk.get(row.askId);
      if (list) list.push(row.familyId);
      else familyIdsByAsk.set(row.askId, [row.familyId]);
    }
  }

  // spokenName is nullable in schema (ADR-0016 placeholder mentions) but an ask always targets a
  // named narrator, so it is never null here; `?? ""` is a compiler guard, not a real fallback.
  return baseRows.map((r) => ({
    ask: r.ask,
    targetSpokenName: r.targetSpokenName ?? "",
    familyIds: familyIdsByAsk.get(r.ask.id) ?? [],
  }));
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
  return rows.map((r) => ({ ask: r.ask, askerSpokenName: r.askerSpokenName ?? "" }));
}
