/**
 * The consent ledger API. This is the ONLY supported way to write consent.
 *
 * It exposes append + read only — never update or delete (the database trigger enforces this
 * too, as defense in depth). A revocation is recorded by appending a new `revoked` event, which
 * the authorization function reads as the latest sharing state. Consent is owned by the Person.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
// consentRecords is NOT a content table (it is the ledger, protected by its append-only
// trigger), so it lives in the open /schema surface — consent.ts needs no /content access.
import { consentRecords } from "@chronicle/db/schema";
import type { ConsentAction, ConsentRecord, Database } from "@chronicle/db";

export interface RecordConsentInput {
  /** Whose consent this is (the author/owner of the content). */
  personId: string;
  /** The story this consent concerns (usual case). */
  storyId?: string;
  /** A broader scope, when not story-specific (e.g. a membership). */
  scope?: string;
  action: ConsentAction;
  /** The resulting state (e.g. the tier set, or the story state reached). */
  resultingState: string;
  /** Pointer to the approval-audio Media — so consent has a voice, not just a row. */
  approvalAudioMediaId?: string;
  /** The actor who recorded the event (the narrator, for a voice approval). */
  actorPersonId: string;
}

/** Append a consent event. The single write path for the ledger. */
export async function recordConsent(
  db: Database,
  input: RecordConsentInput,
): Promise<ConsentRecord> {
  const [row] = await db
    .insert(consentRecords)
    .values({
      personId: input.personId,
      storyId: input.storyId ?? null,
      scope: input.scope ?? null,
      action: input.action,
      resultingState: input.resultingState,
      approvalAudioMediaId: input.approvalAudioMediaId ?? null,
      actorPersonId: input.actorPersonId,
    })
    .returning();
  return row!;
}

/** Full consent history for a story, in chronological (append) order. */
export async function getConsentHistory(
  db: Database,
  storyId: string,
): Promise<ConsentRecord[]> {
  return db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.storyId, storyId))
    .orderBy(asc(consentRecords.seq));
}

/**
 * Whether a story is currently shared, derived from the ledger: the most recent of
 * `approved_for_sharing` / `revoked` wins. Mirrors the authorization function's own reading so
 * the two never diverge.
 */
export async function isCurrentlyShared(
  db: Database,
  storyId: string,
): Promise<boolean> {
  const rows = await db
    .select({ action: consentRecords.action })
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.storyId, storyId),
        inArray(consentRecords.action, ["approved_for_sharing", "revoked"]),
      ),
    )
    .orderBy(desc(consentRecords.seq))
    .limit(1);
  return rows[0]?.action === "approved_for_sharing";
}
