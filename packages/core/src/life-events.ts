/**
 * Life events (ADR-0026) — dated milestones per Person (`wedding | graduation |
 * military_service | move | other`) in the same three-form occurrence shape as the Story date.
 * They are the reusable anchors the Story date resolver derives relative references against
 * ("about ten years after we married" → wedding + 10y); `persons.birth_date` is the primary
 * anchor, these cover the rest.
 *
 * Life events are written ONLY as a by-product of story-date capture (a telling or follow-up
 * answer that supplies an anchor fact stores both the story's date and the reusable event) —
 * there is no profile or onboarding event-entry surface in v1. This module holds both sides:
 * the read (`listLifeEventsForPerson`, feeding the interviewer's session anchors) and the write
 * (`recordStatedLifeEvent`, issue #245).
 *
 * The table is on the OPEN schema (identity, not expressive content), so these are non-content
 * reads/writes — the same posture as the biographical-anchors access in narrator-profile.ts.
 */
import { and, asc, eq } from "drizzle-orm";
import { lifeEvents } from "@chronicle/db/schema";
import type { Database, LifeEvent } from "@chronicle/db";
import type { LifeEventAnchor, StatedLifeEvent } from "./resolve-story-date";

/**
 * List a person's known life events, pared to what date derivation needs (`LifeEventAnchor`:
 * kind + ISO calendar date; a period event contributes its span start). Ordered by date so the
 * resolver sees anchors in life order.
 */
export async function listLifeEventsForPerson(
  db: Database,
  personId: string,
): Promise<LifeEventAnchor[]> {
  const rows = await db
    .select({ kind: lifeEvents.kind, date: lifeEvents.occurredDate })
    .from(lifeEvents)
    .where(eq(lifeEvents.personId, personId))
    .orderBy(asc(lifeEvents.occurredDate));
  return rows.map((r) => ({ kind: r.kind, date: r.date }));
}

export interface RecordStatedLifeEventResult {
  /** False when the same fact (person + kind + date) was already recorded — a no-op, not a dup. */
  created: boolean;
  /** The row as stored — the freshly inserted one, or the existing one it matched. */
  event: LifeEvent;
}

/**
 * Record a life-event fact stated in a telling (issue #245). IDEMPOTENT per person + kind +
 * date: re-stating the same fact (a later take, a retold story) returns the existing row and
 * writes nothing. The event attaches to the narrator who stated it ONLY — there is no mirroring
 * onto a spouse or kin (a wedding is stored on the teller; the partner's own telling stores
 * their own). Like `applyResolvedStoryDate`, this is derived/regenerable metadata carrying its
 * own user-visible provenance note, so it appends no revision row — the note IS the audit trail.
 */
export async function recordStatedLifeEvent(
  db: Database,
  personId: string,
  event: StatedLifeEvent,
): Promise<RecordStatedLifeEventResult> {
  const [existing] = await db
    .select()
    .from(lifeEvents)
    .where(
      and(
        eq(lifeEvents.personId, personId),
        eq(lifeEvents.kind, event.kind),
        eq(lifeEvents.occurredDate, event.occurrence.date),
      ),
    )
    .limit(1);
  if (existing) return { created: false, event: existing };

  const [row] = await db
    .insert(lifeEvents)
    .values({
      personId,
      kind: event.kind,
      occurredKind: event.occurrence.kind,
      occurredDate: event.occurrence.date,
      occurredEndDate: event.occurrence.endDate,
      occurredProvenance: event.occurrence.provenance,
    })
    .returning();
  return { created: true, event: row! };
}
