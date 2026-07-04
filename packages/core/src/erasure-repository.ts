/**
 * ADR-0008 — the audited erasure path. Deletion is always available: an owner erases their own
 * content (right-to-erasure); a steward deletes content shared to a family they steward (moderation).
 * Erasure is a HARD delete — the item, its content/approval audio, and (for a story) its consent
 * ledger are removed and the bytes reclaimed. The FACT of the deletion survives in `erasure_audit`.
 *
 * This is a guarded content-write path (it touches stories/media/prose/etc); it is on the
 * architecture ALLOWLIST. All Story/Media table access goes through @chronicle/db/content.
 *
 * The cascade ORDER is load-bearing (ADR-0008). The consent ledger is the ONLY lock on a consented
 * story's audio: `consent_records` DELETE is permitted solely inside a transaction that sets the
 * transaction-local GUC `chronicle.cascade_delete_story` to the story id, and `media`/
 * `story_recordings`/`prose_revisions` delete-guards key off "does the story still have consent?".
 * So we: set the token → delete the consent ledger FIRST (its token gate is the only thing holding
 * the audio) → delete the other story children → delete the story → delete the now-orphan audio LAST
 * (once no live item references it, the existence-scoped media guard permits it) → write the audit row.
 */
import { eq, inArray, sql } from "drizzle-orm";
import {
  media,
  proseRevisions,
  stories,
  storyImages,
  storyRecordings,
} from "@chronicle/db/content";
import {
  consentRecords,
  erasureAudit,
  families,
  storyFamilies,
} from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import { viewerPersonId, type AuthContext } from "./authorization";

export type EraseResult =
  | { readonly allowed: false; readonly reason: string }
  | { readonly allowed: true; readonly storageKeys: string[] };

/** The audit provenance for an allowed erasure. */
type EraseReason = "owner_erasure" | "steward_moderation";

/**
 * The manage decision for a delete: the OWNER may always erase their own content (right-to-erasure);
 * a STEWARD of any family the item is shared to may erase it (moderation). Anyone else is denied.
 * A single discriminated union: on allow it carries the audit `reason`; on deny it carries the
 * denial message — so the caller never needs a non-null assertion to read either.
 */
type ManageDecision =
  | { readonly allowed: true; readonly reason: EraseReason }
  | { readonly allowed: false; readonly reason: string };

function decideManage(
  viewer: string | null,
  ownerPersonId: string,
  stewardPersonIds: readonly (string | null)[],
): ManageDecision {
  if (viewer === null) return { allowed: false, reason: "anonymous cannot erase content" };
  if (viewer === ownerPersonId) return { allowed: true, reason: "owner_erasure" };
  if (stewardPersonIds.some((s) => s === viewer)) {
    return { allowed: true, reason: "steward_moderation" };
  }
  return {
    allowed: false,
    reason: "viewer is neither the owner nor a steward of a family the item is shared to",
  };
}

/**
 * Resolve the object-storage keys for a set of media ids, returned so the caller can best-effort
 * delete the blobs after the tx commits. Guards the `inArray(col, [])` → `IN ()` Postgres error by
 * short-circuiting on an empty id set. Shared by every erase path (story/ask/voice_caption).
 */
async function resolveStorageKeys(
  tx: Pick<Database, "select">,
  mediaIds: string[],
): Promise<string[]> {
  if (mediaIds.length === 0) return [];
  const rows = await tx
    .select({ storageKey: media.storageKey })
    .from(media)
    .where(inArray(media.id, mediaIds));
  return rows.map((m) => m.storageKey);
}

/**
 * Append the ADR-0008 erasure-audit row — the append-only record that a deletion happened, which
 * outlives the erased content. Shared by every erase path (story/ask/voice_caption).
 */
async function insertErasureAudit(
  tx: Pick<Database, "insert">,
  row: {
    itemType: "story" | "ask" | "voice_caption";
    itemId: string;
    ownerPersonId: string;
    actorPersonId: string;
    reason: EraseReason;
  },
): Promise<void> {
  await tx.insert(erasureAudit).values(row);
}

export async function eraseStory(
  db: Database,
  ctx: AuthContext,
  input: { storyId: string },
): Promise<EraseResult> {
  const viewer = viewerPersonId(ctx);
  // Erasure requires an identified actor (owner or steward); an anonymous request can be neither.
  // Guarding here also narrows `viewer` to a string for the audit `actorPersonId` below (no `!`).
  if (viewer === null) return { allowed: false, reason: "anonymous cannot erase content" };

  const [story] = await db
    .select({ id: stories.id, ownerPersonId: stories.ownerPersonId })
    .from(stories)
    .where(eq(stories.id, input.storyId))
    .limit(1);
  if (!story) return { allowed: false, reason: `story ${input.storyId} not found` };

  // The stewards of every family the story is targeted to — any of them may moderate-delete it.
  const stewardRows = await db
    .select({ stewardPersonId: families.stewardPersonId })
    .from(storyFamilies)
    .innerJoin(families, eq(families.id, storyFamilies.familyId))
    .where(eq(storyFamilies.storyId, input.storyId));
  const decision = decideManage(
    viewer,
    story.ownerPersonId,
    stewardRows.map((r) => r.stewardPersonId),
  );
  if (!decision.allowed) return { allowed: false, reason: decision.reason };

  const storageKeys = await db.transaction(async (tx) => {
    // Set the transaction-local cascade token: this is the ONLY thing that lets the consent-ledger
    // DELETE below through the append-only trigger (invariants.sql, ADR-0008). Scoped to THIS tx.
    await tx.execute(
      sql`select set_config('chronicle.cascade_delete_story', ${input.storyId}, true)`,
    );

    // Gather every audio Media this story owns: the canonical recording pointer, every take's media
    // (ordered take set, ADR-0012), and the approval-audio clip(s) on the consent ledger. These are
    // deleted LAST, after every live referencer is gone, so the existence-scoped media guard permits it.
    const takeRows = await tx
      .select({ mediaId: storyRecordings.mediaId })
      .from(storyRecordings)
      .where(eq(storyRecordings.storyId, input.storyId));
    const approvalRows = await tx
      .select({ mediaId: consentRecords.approvalAudioMediaId })
      .from(consentRecords)
      .where(eq(consentRecords.storyId, input.storyId));
    const [full] = await tx
      .select({ recordingMediaId: stories.recordingMediaId })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    const mediaIds = [
      ...new Set(
        [
          full?.recordingMediaId ?? null,
          ...takeRows.map((t) => t.mediaId),
          ...approvalRows.map((a) => a.mediaId),
        ].filter((id): id is string => id !== null),
      ),
    ];
    const keys = await resolveStorageKeys(tx, mediaIds);

    // Delete children in FK order, CONSENT LEDGER FIRST (its token gate is the only lock on the
    // audio; once the consent rows are gone, the prose/recording delete-guards see "no consent" and
    // permit their deletes without a token, and the media guard permits the orphan audio delete).
    await tx.delete(storyFamilies).where(eq(storyFamilies.storyId, input.storyId));
    await tx.delete(storyImages).where(eq(storyImages.storyId, input.storyId));
    await tx.delete(consentRecords).where(eq(consentRecords.storyId, input.storyId));
    await tx.delete(storyRecordings).where(eq(storyRecordings.storyId, input.storyId));
    await tx.delete(proseRevisions).where(eq(proseRevisions.storyId, input.storyId));
    await tx.delete(stories).where(eq(stories.id, input.storyId));
    // Media LAST — the story (and every other referencer) is gone, so no live item references it.
    if (mediaIds.length > 0) {
      await tx.delete(media).where(inArray(media.id, mediaIds));
    }

    // The append-only record that the deletion happened — outlives the erased content.
    await insertErasureAudit(tx, {
      itemType: "story",
      itemId: input.storyId,
      ownerPersonId: story.ownerPersonId,
      actorPersonId: viewer,
      reason: decision.reason,
    });

    return keys;
  });

  return { allowed: true, storageKeys };
}
