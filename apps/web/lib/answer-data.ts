/**
 * Answer-page data helpers — narrow reads from the open `asks` + `persons` tables (not behind the
 * content guard). Used only by the hub answer page server component.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { asks, persons } from "@chronicle/db/schema";
import type { AskStatus, Database } from "@chronicle/db";

export interface AskDetail {
  id: string;
  questionText: string;
  targetPersonId: string;
  status: AskStatus;
  askerSpokenName: string;
}

/**
 * Load a single Ask targeted at the given narrator. Returns null if the ask is missing OR if it
 * is not targeted at this narrator (defense against the client guessing another person's askId).
 */
export async function getAskForNarrator(
  db: Database,
  askId: string,
  narratorPersonId: string,
): Promise<AskDetail | null> {
  const rows = await db
    .select({
      id: asks.id,
      questionText: asks.questionText,
      targetPersonId: asks.targetPersonId,
      status: asks.status,
      askerSpokenName: persons.spokenName,
    })
    .from(asks)
    .innerJoin(persons, eq(persons.id, asks.askerPersonId))
    .where(eq(asks.id, askId))
    .limit(1);

  const row = rows[0];
  if (!row || row.targetPersonId !== narratorPersonId) return null;
  // askerSpokenName is nullable in schema (ADR-0016) but an asker is a named person; `?? ""` guard.
  return { ...row, askerSpokenName: row.askerSpokenName ?? "" };
}
