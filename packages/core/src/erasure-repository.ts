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
  familyPhotoFamilies,
  media,
  proseRevisions,
  stories,
  storyImages,
  storyRecordings,
  storyLikes,
  storyFavorites,
} from "@chronicle/db/content";
import {
  askFamilies,
  asks,
  askSubjectPhotos,
  consentRecords,
  erasureAudit,
  families,
  storyFamilies,
  voiceCaptions,
  storyViews,
  followUpDecisions,
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
    await tx.delete(storyLikes).where(eq(storyLikes.storyId, input.storyId));
    await tx.delete(storyFavorites).where(eq(storyFavorites.storyId, input.storyId));
    await tx.delete(storyViews).where(eq(storyViews.storyId, input.storyId));
    await tx.delete(followUpDecisions).where(eq(followUpDecisions.storyId, input.storyId));
    await tx.update(asks).set({ storyId: null }).where(eq(asks.storyId, input.storyId));
    await tx.delete(consentRecords).where(eq(consentRecords.storyId, input.storyId));
    await tx.delete(proseRevisions).where(eq(proseRevisions.storyId, input.storyId));
    await tx.delete(storyRecordings).where(eq(storyRecordings.storyId, input.storyId));
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

/**
 * Erase an Ask (ADR-0008). An Ask is owned by its asker (right-to-erasure) and moderatable by the
 * steward of ANY family it is addressed to (`ask_families` — an unaddressed Ask targets no family,
 * so has no steward, and only the asker may erase). Unlike a story, an Ask has NO consent ledger, so
 * NO cascade token is needed: once the parent `asks` row is gone, the existence-scoped media guard
 * permits deleting its question audio. So delete the parent row FIRST, then its (voice-origin only)
 * recording media, in one transaction. `ask_subject_photos` cascades on the ask delete (FK ON DELETE
 * CASCADE); `ask_families` has a plain FK so its rows are cleared explicitly before the ask row. The
 * produced answer (`asks.story_id`, if any) is a SEPARATE item — untouched.
 */
export async function eraseAsk(
  db: Database,
  ctx: AuthContext,
  input: { askId: string },
): Promise<EraseResult> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) return { allowed: false, reason: "anonymous cannot erase content" };

  const [ask] = await db
    .select({
      id: asks.id,
      askerPersonId: asks.askerPersonId,
      recordingMediaId: asks.recordingMediaId,
    })
    .from(asks)
    .where(eq(asks.id, input.askId))
    .limit(1);
  if (!ask) return { allowed: false, reason: `ask ${input.askId} not found` };

  // The steward of ANY family the Ask is addressed to (ask_families ⋈ families) may moderate-delete
  // it. An ask may target one-or-more families now, so gather every one of their stewards.
  const stewardRows = await db
    .select({ stewardPersonId: families.stewardPersonId })
    .from(askFamilies)
    .innerJoin(families, eq(families.id, askFamilies.familyId))
    .where(eq(askFamilies.askId, input.askId));
  const stewardIds: (string | null)[] = stewardRows.map((r) => r.stewardPersonId);
  const decision = decideManage(viewer, ask.askerPersonId, stewardIds);
  if (!decision.allowed) return { allowed: false, reason: decision.reason };

  const storageKeys = await db.transaction(async (tx) => {
    // Voice-origin only: `recordingMediaId` is set iff the question was recorded.
    const keys = ask.recordingMediaId ? await resolveStorageKeys(tx, [ask.recordingMediaId]) : [];
    // Parent row FIRST (there is no consent lock), then its now-orphan audio.
    await tx.delete(askSubjectPhotos).where(eq(askSubjectPhotos.askId, input.askId));
    // `ask_families` has a plain (no-cascade) FK to asks, so its rows must be removed before the
    // parent ask row or the delete would violate the FK.
    await tx.delete(askFamilies).where(eq(askFamilies.askId, input.askId));
    await tx.delete(asks).where(eq(asks.id, input.askId));
    if (ask.recordingMediaId) {
      await tx.delete(media).where(eq(media.id, ask.recordingMediaId));
    }
    await insertErasureAudit(tx, {
      itemType: "ask",
      itemId: input.askId,
      ownerPersonId: ask.askerPersonId,
      actorPersonId: viewer,
      reason: decision.reason,
    });
    return keys;
  });

  return { allowed: true, storageKeys };
}

/**
 * Erase a voice caption (ADR-0008). A voice caption is owned by `voiceCaptions.ownerPersonId`
 * (right-to-erasure) and moderatable by the steward of ANY family the underlying photo is placed in
 * (`family_photo_families ⋈ families.steward_person_id`). Like an Ask, a voice caption has NO consent
 * ledger, so NO cascade token is needed: delete the parent `voice_captions` row FIRST, then its
 * un-detachable `caption_audio` media (always present — `mediaId` is NOT NULL), in one transaction.
 */
export async function eraseVoiceCaption(
  db: Database,
  ctx: AuthContext,
  input: { voiceCaptionId: string },
): Promise<EraseResult> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) return { allowed: false, reason: "anonymous cannot erase content" };

  const [vc] = await db
    .select({
      id: voiceCaptions.id,
      photoId: voiceCaptions.photoId,
      mediaId: voiceCaptions.mediaId,
      ownerPersonId: voiceCaptions.ownerPersonId,
    })
    .from(voiceCaptions)
    .where(eq(voiceCaptions.id, input.voiceCaptionId))
    .limit(1);
  if (!vc) return { allowed: false, reason: `voice caption ${input.voiceCaptionId} not found` };

  // The steward of any family the underlying photo is placed in may moderate-delete the caption.
  const stewardRows = await db
    .select({ stewardPersonId: families.stewardPersonId })
    .from(familyPhotoFamilies)
    .innerJoin(families, eq(families.id, familyPhotoFamilies.familyId))
    .where(eq(familyPhotoFamilies.photoId, vc.photoId));
  const decision = decideManage(
    viewer,
    vc.ownerPersonId,
    stewardRows.map((r) => r.stewardPersonId),
  );
  if (!decision.allowed) return { allowed: false, reason: decision.reason };

  const storageKeys = await db.transaction(async (tx) => {
    const keys = await resolveStorageKeys(tx, [vc.mediaId]);
    // Parent row FIRST (no consent lock), then its now-orphan caption audio.
    await tx.delete(voiceCaptions).where(eq(voiceCaptions.id, input.voiceCaptionId));
    await tx.delete(media).where(eq(media.id, vc.mediaId));
    await insertErasureAudit(tx, {
      itemType: "voice_caption",
      itemId: input.voiceCaptionId,
      ownerPersonId: vc.ownerPersonId,
      actorPersonId: viewer,
      reason: decision.reason,
    });
    return keys;
  });

  return { allowed: true, storageKeys };
}
