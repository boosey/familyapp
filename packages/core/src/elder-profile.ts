/**
 * Elder-profile read helper for the token-scoped capture surface.
 *
 * Why this exists: the elder web page needs the spoken name to greet the elder warmly. That is a
 * *non-content* read (persons table is on the open schema, not behind the front-door guard), but
 * routing it through a core helper keeps with the spirit of "endpoints do not roll their own
 * access logic" (spec Part II / V) — the same pattern we enforce structurally for Story/Media is
 * followed here by convention, so the elder surface has a single read path too.
 */
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";

export interface ElderProfile {
  personId: string;
  /** The name the interviewer/greeting should speak aloud. */
  spokenName: string;
}

/**
 * Look up the elder's greeting profile by Person id (the id the session token resolved to).
 * Returns null only if the row is missing (which would indicate a broken session pointer).
 */
export async function getElderProfile(
  db: Database,
  personId: string,
): Promise<ElderProfile | null> {
  const [row] = await db
    .select({ spokenName: persons.spokenName })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  if (!row) return null;
  return { personId, spokenName: row.spokenName };
}

/**
 * The fuller, lightly-held biographical context the interviewer "arrives prepared" with. This
 * stays on the OPEN (non-content) read surface because the persons table is not behind the
 * front-door guard — it's identity, not expressive content. The interviewer is instructed by
 * its system prompt to treat these as hints, never as ground truth.
 */
export interface ElderBiographicalContext {
  personId: string;
  spokenName: string;
  birthYear: number | null;
  /** `persons.biographical_anchors` jsonb — birthplace, profession, etc. Free-form. */
  anchors: Record<string, unknown>;
}

export async function getElderBiographicalContext(
  db: Database,
  personId: string,
): Promise<ElderBiographicalContext | null> {
  const [row] = await db
    .select({
      spokenName: persons.spokenName,
      birthYear: persons.birthYear,
      anchors: persons.biographicalAnchors,
    })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  if (!row) return null;
  return {
    personId,
    spokenName: row.spokenName,
    birthYear: row.birthYear,
    anchors: (row.anchors ?? {}) as Record<string, unknown>,
  };
}
