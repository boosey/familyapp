/**
 * Life events (ADR-0026) — dated milestones per Person (`wedding | graduation |
 * military_service | move | other`) in the same three-form occurrence shape as the Story date.
 * They are the reusable anchors the Story date resolver derives relative references against
 * ("about ten years after we married" → wedding + 10y); `persons.birth_date` is the primary
 * anchor, these cover the rest.
 *
 * Life events are written ONLY as a by-product of story-date capture (a follow-up answer that
 * supplies an anchor fact stores both the story's date and the reusable event) — there is no
 * profile or onboarding event-entry surface in v1. This module holds the read side; the write
 * side lands with life-event capture (#245).
 *
 * The table is on the OPEN schema (identity, not expressive content), so this is a non-content
 * read — the same posture as the biographical-anchors read in narrator-profile.ts.
 */
import { asc, eq } from "drizzle-orm";
import { lifeEvents } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import type { LifeEventAnchor } from "./resolve-story-date";

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
