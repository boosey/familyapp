/**
 * Narration preferences (#351 / ADR-0029) — the per-account (per-narrator) booleans that live on
 * `persons` and shape how the interviewer behaves toward this Person:
 *
 *   - `followUpsOptOut`      — TRUE → the follow-up cascade short-circuits at the top (no evaluation
 *                              LLM, no ask). Gates ONLY the narrator-facing ask; memory extraction
 *                              (a separate post-approval pipeline) is unaffected. Default FALSE (ON).
 *   - `askSuggestionOptOut`  — TRUE → the "suggest better wording for my questions" helper is off.
 *                              Default FALSE (ON). No code path consumes this yet (persisted only).
 *
 * Reads/writes route through core (the `persons` table is on the open schema, but "endpoints do not
 * roll their own access logic" — the same convention getNarratorProfile follows). Both the Account
 * Narration section (writes) and the follow-up call site (read) share these helpers.
 */
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";

export interface NarrationPreferences {
  /** TRUE → follow-ups are suppressed for this narrator (#351). Default FALSE = follow-ups ON. */
  followUpsOptOut: boolean;
  /** TRUE → ask-suggestion helper off. Default FALSE = suggestions ON. */
  askSuggestionOptOut: boolean;
}

/**
 * Read both narration preference booleans for a Person. Returns the safe defaults (both FALSE =
 * everything ON) when the row is missing, so a broken pointer never accidentally suppresses.
 */
export async function getNarrationPreferences(
  db: Database,
  personId: string,
): Promise<NarrationPreferences> {
  const [row] = await db
    .select({
      followUpsOptOut: persons.followUpsOptOut,
      askSuggestionOptOut: persons.askSuggestionOptOut,
    })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  return {
    followUpsOptOut: row?.followUpsOptOut ?? false,
    askSuggestionOptOut: row?.askSuggestionOptOut ?? false,
  };
}

/**
 * The narrator's follow-up opt-out (#351), read at the cascade call site. TRUE → suppress. Missing
 * row → FALSE (follow-ups ON) so an unknown narrator is never silently muted.
 */
export async function getFollowUpsOptOut(db: Database, personId: string): Promise<boolean> {
  const { followUpsOptOut } = await getNarrationPreferences(db, personId);
  return followUpsOptOut;
}

/** Persist the follow-up opt-out (#351). */
export async function setFollowUpsOptOut(
  db: Database,
  personId: string,
  optOut: boolean,
): Promise<void> {
  await db
    .update(persons)
    .set({ followUpsOptOut: optOut, updatedAt: new Date() })
    .where(eq(persons.id, personId));
}

/**
 * Persist the ask-suggestion opt-out. No code path consumes this flag yet — the "suggest better
 * wording for my questions" helper is not built — so this is persist-only for now (ADR-0029).
 */
export async function setAskSuggestionOptOut(
  db: Database,
  personId: string,
  optOut: boolean,
): Promise<void> {
  await db
    .update(persons)
    .set({ askSuggestionOptOut: optOut, updatedAt: new Date() })
    .where(eq(persons.id, personId));
}
