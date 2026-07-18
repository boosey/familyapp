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
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  familyPhotoFamilies,
  media,
  photoPlaces,
  places,
  proseRevisions,
  stories,
  storyImages,
  storyRecordings,
  storyLikes,
  storyFavorites,
  storySubjects,
} from "@chronicle/db/content";
import {
  accounts,
  accountContacts,
  accountIdentities,
  askFamilies,
  asks,
  askSubjectPhotos,
  consentRecords,
  erasureAudit,
  families,
  googlePhotosConnections,
  intakeAnswers,
  invitations,
  joinRequests,
  linkSessions,
  memberships,
  persons,
  storyFamilies,
  voiceCaptions,
  storyViews,
  followUpDecisions,
} from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import { viewerPersonId, type AuthContext } from "./authorization";

/**
 * A minimal write-capable handle: the outer `Database` OR the transaction object handed to a
 * `db.transaction` callback. The pure cascade helpers below run inside an already-open tx, so they
 * type against this rather than the full `Database` (which the transaction object does not satisfy).
 */
type TxLike = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;

/**
 * Run a raw existence query and report whether it returned any row. The PGlite/postgres.js drivers
 * both return a `{ rows: [...] }` result object from `execute`, but the base `PgQueryResultHKT` on
 * our `Database` type erases that shape — so we narrow it here in one audited place rather than
 * scattering casts. Used for the cross-table person/kinship reference checks below.
 */
async function existsByRawQuery(tx: TxLike, query: ReturnType<typeof sql>): Promise<boolean> {
  const result = (await tx.execute(query)) as unknown as { rows: unknown[] };
  return result.rows.length > 0;
}

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

/**
 * The PURE story-erasure cascade — no auth, no `erasure_audit` row. Given an OPEN transaction and a
 * story id, it sets the `chronicle.cascade_delete_story` token, tears the story's children down in
 * the FK-safe order (consent ledger FIRST — its token gate is the only lock on the audio), deletes
 * the story, reclaims the now-orphan audio LAST, and returns the reclaimed storage keys. Shared by
 * the guarded `eraseStory` (which wraps it with auth + an audit row) and the unguarded
 * `eraseAccount` (which cascades every story the erased Person owns, and writes NO per-item audit).
 * The order here is load-bearing (see the file header + ADR-0008); keep it and eraseStory in sync.
 */
async function eraseStoryCascade(tx: TxLike, storyId: string): Promise<string[]> {
  // Set the transaction-local cascade token: the ONLY thing that lets the consent-ledger DELETE
  // below through the append-only trigger (invariants.sql, ADR-0008). Scoped to THIS tx.
  await tx.execute(sql`select set_config('chronicle.cascade_delete_story', ${storyId}, true)`);

  // Gather every audio Media this story owns: the canonical recording pointer, every take's media,
  // and the approval-audio clip(s) on the consent ledger. Deleted LAST, after every live referencer.
  const takeRows = await tx
    .select({ mediaId: storyRecordings.mediaId })
    .from(storyRecordings)
    .where(eq(storyRecordings.storyId, storyId));
  const approvalRows = await tx
    .select({ mediaId: consentRecords.approvalAudioMediaId })
    .from(consentRecords)
    .where(eq(consentRecords.storyId, storyId));
  const [full] = await tx
    .select({ recordingMediaId: stories.recordingMediaId })
    .from(stories)
    .where(eq(stories.id, storyId))
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

  // Delete children in FK order, CONSENT LEDGER FIRST (its token gate is the only lock on the audio).
  await tx.delete(storyFamilies).where(eq(storyFamilies.storyId, storyId));
  await tx.delete(storyImages).where(eq(storyImages.storyId, storyId));
  await tx.delete(storyLikes).where(eq(storyLikes.storyId, storyId));
  await tx.delete(storyFavorites).where(eq(storyFavorites.storyId, storyId));
  await tx.delete(storySubjects).where(eq(storySubjects.storyId, storyId));
  await tx.delete(storyViews).where(eq(storyViews.storyId, storyId));
  await tx.delete(followUpDecisions).where(eq(followUpDecisions.storyId, storyId));
  await tx.update(asks).set({ storyId: null }).where(eq(asks.storyId, storyId));
  // Detach any FOLLOW-UP asks whose SOURCE is this story (#77). The FK is ON DELETE SET NULL, so
  // this explicit null-out is belt-and-suspenders — kept for symmetry and explicit intent.
  await tx.update(asks).set({ sourceStoryId: null }).where(eq(asks.sourceStoryId, storyId));
  await tx.delete(consentRecords).where(eq(consentRecords.storyId, storyId));
  await tx.delete(proseRevisions).where(eq(proseRevisions.storyId, storyId));
  await tx.delete(storyRecordings).where(eq(storyRecordings.storyId, storyId));
  await tx.delete(stories).where(eq(stories.id, storyId));
  // Media LAST — the story (and every other referencer) is gone.
  if (mediaIds.length > 0) {
    await tx.delete(media).where(inArray(media.id, mediaIds));
  }
  return keys;
}

/**
 * The PURE ask-erasure cascade — no auth, no audit row. An Ask has NO consent ledger, so no cascade
 * token is needed: delete `ask_subject_photos` (FK cascade would also handle it) and the `ask_families`
 * join (plain FK, must precede the ask), then the ask row, then its (voice-origin only) question audio.
 */
async function eraseAskCascade(
  tx: TxLike,
  ask: { id: string; recordingMediaId: string | null },
): Promise<string[]> {
  const keys = ask.recordingMediaId ? await resolveStorageKeys(tx, [ask.recordingMediaId]) : [];
  await tx.delete(askSubjectPhotos).where(eq(askSubjectPhotos.askId, ask.id));
  await tx.delete(askFamilies).where(eq(askFamilies.askId, ask.id));
  await tx.delete(asks).where(eq(asks.id, ask.id));
  if (ask.recordingMediaId) {
    await tx.delete(media).where(eq(media.id, ask.recordingMediaId));
  }
  return keys;
}

/**
 * The PURE voice-caption cascade — no auth, no audit row. No consent ledger: delete the caption row
 * FIRST, then its un-detachable `caption_audio` media (always present; `mediaId` is NOT NULL).
 */
async function eraseVoiceCaptionCascade(
  tx: TxLike,
  vc: { id: string; mediaId: string },
): Promise<string[]> {
  const keys = await resolveStorageKeys(tx, [vc.mediaId]);
  await tx.delete(voiceCaptions).where(eq(voiceCaptions.id, vc.id));
  await tx.delete(media).where(eq(media.id, vc.mediaId));
  return keys;
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
    // The pure cascade (token dance + FK-safe teardown + orphan-audio reclaim). Its ORDER is
    // load-bearing (see the file header + ADR-0008); it lives in one place so eraseAccount reuses it.
    const keys = await eraseStoryCascade(tx, input.storyId);

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
    const keys = await eraseAskCascade(tx, {
      id: ask.id,
      recordingMediaId: ask.recordingMediaId,
    });
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
    const keys = await eraseVoiceCaptionCascade(tx, { id: vc.id, mediaId: vc.mediaId });
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

// ===========================================================================
// eraseAccount — the UNGUARDED admin/maintenance account-erasure path (ADR-0008 extension).
// ===========================================================================

/**
 * The result of `eraseAccount`. On refusal it carries the human-readable blockers and NOTHING was
 * changed; on success it carries whether the Person row was demoted (kept as an account-less tree
 * node, still referenced by retained data) or hard-deleted, plus the reclaimed storage keys.
 */
export type EraseAccountResult =
  | { readonly ok: false; readonly blockers: readonly string[] }
  | {
      readonly ok: true;
      readonly outcome: "demoted" | "deleted";
      readonly storageKeys: readonly string[];
    };

/**
 * Erase a Person's ACCOUNT and all of their solely-owned content, then decide the Person row's fate
 * automatically: HARD-DELETE it if nothing retained still references it, otherwise DEMOTE it to an
 * account-less tree node (kept because kinship edges / others' content still point at it — and the
 * kinship ledger is append-only with no erasure carve-out, so those edges must survive).
 *
 * ⚠️ UNGUARDED. This is an admin/maintenance function — it takes NO AuthContext and performs NO
 * viewer authorization. That is WHY it is surfaced in no UI: exposing it on a request path would let
 * a caller nuke any account. Its only safety rail is the BLOCKERS pre-check (it refuses to erase an
 * account whose removal would silently harm OTHER people — a co-stewarded family or a story shared
 * to a family with other members). Call it only from a trusted maintenance context.
 *
 * All work runs in ONE transaction. Blockers are computed BEFORE any mutation; if non-empty the
 * function returns `{ ok:false }` having changed nothing.
 */
export async function eraseAccount(
  db: Database,
  input: { personId: string },
): Promise<EraseAccountResult> {
  const { personId } = input;

  const [person] = await db
    .select({ id: persons.id, accountId: persons.accountId })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  if (!person) return { ok: false, blockers: [`person ${personId} not found`] };

  // --- BLOCKERS (refuse if any). Computed BEFORE any mutation. --------------------------------
  const blockers: string[] = [];

  // (1) Families this person creates/stewards that have ANY OTHER active member. Erasing the person
  //     would orphan a family other people still actively belong to. One selectDistinct + innerJoin
  //     (matching blockers (3)/(4)): the join to an OTHER active membership IS the "has other members"
  //     predicate, so only offending families come back.
  const blockedFamilies = await db
    .selectDistinct({ id: families.id })
    .from(families)
    .innerJoin(
      memberships,
      and(
        eq(memberships.familyId, families.id),
        eq(memberships.status, "active"),
        ne(memberships.personId, personId),
      ),
    )
    .where(
      sql`(${families.creatorPersonId} = ${personId} OR ${families.stewardPersonId} = ${personId})`,
    );
  for (const fam of blockedFamilies) {
    blockers.push(`stewards family ${fam.id} which has other active members`);
  }

  // (2) Stories this person owns that are shared to a family with another active member. Erasing the
  //     owner would yank a story out from under readers who still actively share that family. One
  //     selectDistinct + innerJoin (matching blockers (3)/(4)). `ownedStories` is fetched separately
  //     below because the teardown phase reuses the FULL owned-story set, not just the blocking ones.
  const blockedStories = await db
    .selectDistinct({ id: stories.id })
    .from(stories)
    .innerJoin(storyFamilies, eq(storyFamilies.storyId, stories.id))
    .innerJoin(
      memberships,
      and(
        eq(memberships.familyId, storyFamilies.familyId),
        eq(memberships.status, "active"),
        ne(memberships.personId, personId),
      ),
    )
    .where(eq(stories.ownerPersonId, personId));
  for (const story of blockedStories) {
    blockers.push(`story ${story.id} is shared to a family with other members`);
  }

  // The FULL set of stories this person owns — reused by the teardown phase (a) to cascade-erase
  // every one. Kept as its own query (blocker (2) above only surfaces the offending subset).
  const ownedStories = await db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.ownerPersonId, personId));

  // (3) Asks this person ASKED that are addressed (ask_families) to a family with another active
  //     member — erasing the asker would delete an open/answered question out from under a family
  //     that still actively shares it. Same harm class as (2); asks are otherwise torn down in (b).
  const blockedAsks = await db
    .selectDistinct({ id: asks.id })
    .from(asks)
    .innerJoin(askFamilies, eq(askFamilies.askId, asks.id))
    .innerJoin(
      memberships,
      and(
        eq(memberships.familyId, askFamilies.familyId),
        eq(memberships.status, "active"),
        ne(memberships.personId, personId),
      ),
    )
    .where(eq(asks.askerPersonId, personId));
  for (const a of blockedAsks) {
    blockers.push(`ask ${a.id} is addressed to a family with other members`);
  }

  // (4) Voice captions this person OWNS on a photo placed (family_photo_families) into a family with
  //     another active member — erasing the captioner would pull their spoken caption off a photo
  //     others still see. Same harm class as (2)/(3); captions are otherwise torn down in (b).
  const blockedCaptions = await db
    .selectDistinct({ id: voiceCaptions.id })
    .from(voiceCaptions)
    .innerJoin(familyPhotoFamilies, eq(familyPhotoFamilies.photoId, voiceCaptions.photoId))
    .innerJoin(
      memberships,
      and(
        eq(memberships.familyId, familyPhotoFamilies.familyId),
        eq(memberships.status, "active"),
        ne(memberships.personId, personId),
      ),
    )
    .where(eq(voiceCaptions.ownerPersonId, personId));
  for (const c of blockedCaptions) {
    blockers.push(`voice caption ${c.id} is on a photo shared to a family with other members`);
  }

  if (blockers.length > 0) return { ok: false, blockers };

  // --- TEARDOWN + OUTCOME (no blockers). One transaction. -------------------------------------
  return db.transaction(async (tx): Promise<EraseAccountResult> => {
    const storageKeys = new Set<string>();

    // (a) Cascade-erase every story this person OWNS (reuse the exact story cascade; no audit rows).
    for (const story of ownedStories) {
      for (const key of await eraseStoryCascade(tx, story.id)) storageKeys.add(key);
    }

    // (b) Cascade-erase every ask this person ASKED, and every voice caption they OWN.
    const ownedAsks = await tx
      .select({ id: asks.id, recordingMediaId: asks.recordingMediaId })
      .from(asks)
      .where(eq(asks.askerPersonId, personId));
    for (const ask of ownedAsks) {
      for (const key of await eraseAskCascade(tx, ask)) storageKeys.add(key);
    }
    const ownedCaptions = await tx
      .select({ id: voiceCaptions.id, mediaId: voiceCaptions.mediaId })
      .from(voiceCaptions)
      .where(eq(voiceCaptions.ownerPersonId, personId));
    for (const vc of ownedCaptions) {
      for (const key of await eraseVoiceCaptionCascade(tx, vc)) storageKeys.add(key);
    }

    // (c) Engagement rows AUTHORED by this person on OTHERS' (retained) stories.
    await tx.delete(storyViews).where(eq(storyViews.personId, personId));
    await tx.delete(storyFavorites).where(eq(storyFavorites.personId, personId));
    await tx.delete(storyLikes).where(eq(storyLikes.personId, personId));

    // (d) All memberships — "as if they never joined".
    await tx.delete(memberships).where(eq(memberships.personId, personId));

    // (e) Solely-this-person's families: created OR stewarded by them AND (after (d)) with no active
    //     member. The blocker check already guaranteed no OTHER active member; after we dropped this
    //     person's own membership there is none at all, so these families are safe to remove. Delete
    //     their remaining family-scoped leftovers in FK order first.
    const soleFamilies = await tx
      .select({ id: families.id })
      .from(families)
      .where(
        sql`(${families.creatorPersonId} = ${personId} OR ${families.stewardPersonId} = ${personId})`,
      );
    for (const fam of soleFamilies) {
      // NOTE: kinship_assertions / kinship_subject_hides also FK family_id, but they are append-only
      // with NO erasure carve-out (invariants.sql) — they CANNOT be deleted. A family carrying kinship
      // edges therefore cannot be removed; we leave it (and it keeps its now-memberless row). This is
      // the same reason a person carrying kinship edges demotes rather than deletes. To avoid an FK
      // failure we only delete a family with no kinship rows referencing it.
      const hasKinship = await existsByRawQuery(
        tx,
        sql`SELECT 1 FROM kinship_assertions WHERE family_id = ${fam.id}
            UNION ALL SELECT 1 FROM kinship_subject_hides WHERE family_id = ${fam.id} LIMIT 1`,
      );
      if (hasKinship) continue; // leave the family standing; its edges must survive.

      // Every column that FKs `families.id` (enumerated from schema.ts `=> families.id`) MUST be
      // cleared/nulled BEFORE `DELETE families`, or the delete FK-fails and the whole tx rolls back
      // (real accounts then cannot be erased). Classification for THIS doomed family:
      //   - memberships.family_id            (NN) → DELETE ALL rows of the family (see below).
      //   - places.family_id                 (NN) → DELETE child photo_places, then the places.
      //   - photo_places.place_id            (→ places.id, no cascade) → deleted just before places.
      //   - family_photo_families.family_id  (NN) → DELETE the photo↔family link rows.
      //   - stories.originating_family_id    (nullable) → NULL it on any SURVIVING (foreign) story.
      //   - story_families.family_id         (NN) → DELETE the family's share rows. The erasing
      //       person's OWN shares went with their story cascade (a), but a FOREIGN retained person's
      //       story can be shared INTO this family (blocker #2 is owner-scoped, so it never fires); its
      //       share row must be cleared here or DELETE families FK-fails (symmetric to originating_*).
      //   - ask_families.family_id           (NN) → deleted below (asks' addressing).
      //   - invitations.family_id            (NN) → deleted below.
      //   - join_requests.family_id          (NN) → deleted below.
      //   - link_sessions.family_id          (NN) → deleted below.
      //   - kinship_assertions.family_id     (NN, append-only) → handled by the `hasKinship` guard
      //   - kinship_subject_hides.family_id  (NN, append-only) → above (family left standing if any).

      // memberships: DELETE ALL of the doomed family's memberships, not just the erasing person's
      // (their own already went in (d)). Blocker #1 already refused if any OTHER *active* member
      // exists; a paused/ended other member's membership dies with the family being destroyed.
      await tx.delete(memberships).where(eq(memberships.familyId, fam.id));

      // places + photo_places: photo_places.place_id → places.id has NO cascade, so delete the
      // place tags for this family's places FIRST, then the places. (Typed subselect, not raw SQL.)
      await tx.delete(photoPlaces).where(
        inArray(
          photoPlaces.placeId,
          tx.select({ id: places.id }).from(places).where(eq(places.familyId, fam.id)),
        ),
      );
      await tx.delete(places).where(eq(places.familyId, fam.id));

      // family_photo_families: the photo↔family placement link (the photo itself is retained via its
      // contributor). Just the link row for this family.
      await tx.delete(familyPhotoFamilies).where(eq(familyPhotoFamilies.familyId, fam.id));

      // stories.originating_family_id (NULLABLE): the erasing person's OWN stories are already gone
      // (own-story cascade in (a)); only foreign RETAINED stories can still carry this family as their
      // capture context. NULL it — never delete those stories. Ordered AFTER the own-story cascade.
      await tx
        .update(stories)
        .set({ originatingFamilyId: null })
        .where(eq(stories.originatingFamilyId, fam.id));

      // story_families: the erasing person's OWN shares are already gone (own-story cascade in (a)),
      // but a FOREIGN retained person's story can be shared into this family — clear those share rows
      // (the foreign story itself survives, merely detached from the doomed family).
      await tx.delete(storyFamilies).where(eq(storyFamilies.familyId, fam.id));

      // Family-scoped leftovers (FK order). asks' ask_families is torn down likewise. Clear the
      // remaining family-scoped rows before the family row.
      await tx.delete(askFamilies).where(eq(askFamilies.familyId, fam.id));
      await tx.delete(invitations).where(eq(invitations.familyId, fam.id));
      await tx.delete(joinRequests).where(eq(joinRequests.familyId, fam.id));
      await tx.delete(linkSessions).where(eq(linkSessions.familyId, fam.id));
      await tx.delete(families).where(eq(families.id, fam.id));
    }

    // (f) The person's own inbound rows that would block their deletion / are theirs to reclaim:
    //     intake answers (+ their revisions cascade), pending invitations they were INVITED to,
    //     join requests / link sessions that are theirs, and their Google Photos connection. Kept
    //     minimal + FK-guided.
    await tx.delete(intakeAnswers).where(eq(intakeAnswers.personId, personId));
    await tx
      .delete(invitations)
      .where(and(eq(invitations.inviteePersonId, personId), eq(invitations.status, "pending")));
    await tx.delete(joinRequests).where(eq(joinRequests.requesterPersonId, personId));
    await tx.delete(linkSessions).where(eq(linkSessions.personId, personId));
    // The connect-once OAuth vault (ADR-0009 Phase 5): a 1:1 row keyed by person_id holding an
    // ENCRYPTED refresh token. Solely the person's own (no cross-person implications), so it is torn
    // down unconditionally. Load-bearing: if left behind it both strands a live OAuth secret past
    // "erasure" AND — since personStillReferenced counts it — would force every Google-connected
    // person to demote instead of hard-delete.
    await tx.delete(googlePhotosConnections).where(eq(googlePhotosConnections.personId, personId));

    // NOTE: `asks.target_person_id` (open questions addressed TO this person by OTHERS) is retained
    // and left pointing at the row — it forces DEMOTE (below) rather than a delete. We deliberately
    // do NOT block on it: blocking would defeat erasure. The asks simply become dormant against the
    // demoted, account-less node (their asker keeps their question; no data is destroyed).

    // --- OUTCOME: is the Person row STILL referenced by any RETAINED inbound FK? -----------------
    const stillReferenced = await personStillReferenced(tx, personId);

    if (stillReferenced) {
      // DEMOTE: keep the row as an account-less tree node (origin is immutable — untouched).
      await tx.update(persons).set({ accountId: null }).where(eq(persons.id, personId));
      await severAccount(tx, person.accountId);
      return { ok: true, outcome: "demoted", storageKeys: [...storageKeys] };
    }

    // HARD-DELETE: nothing references the person → remove the row, then the (now-unreferenced) account.
    await tx.delete(persons).where(eq(persons.id, personId));
    await severAccount(tx, person.accountId);
    return { ok: true, outcome: "deleted", storageKeys: [...storageKeys] };
  });
}

/**
 * Delete the severable login for `accountId` (no-op when the person had none). The account row has
 * two inbound FK children — `account_identities` (vendor login pointers) and `account_contacts`
 * (verified match keys, ADR provider-agnostic identity / PR #99) — both NOT NULL, so they must be
 * cleared BEFORE the `accounts` row or the delete FK-fails. `persons.account_id` is the only other
 * inbound FK and is already nulled (demote) or gone (hard-delete) by the time this runs.
 */
async function severAccount(
  tx: Pick<Database, "delete">,
  accountId: string | null,
): Promise<void> {
  if (accountId === null) return;
  await tx.delete(accountIdentities).where(eq(accountIdentities.accountId, accountId));
  await tx.delete(accountContacts).where(eq(accountContacts.accountId, accountId));
  await tx.delete(accounts).where(eq(accounts.id, accountId));
}

/**
 * True iff any RETAINED row still has an inbound FK to `persons.id = personId`. This is the full
 * enumerated set of person-referencing columns across the schema (schema.ts). A single
 * UNION-ALL … LIMIT 1 keeps it one round-trip. If ANY survives, the person must DEMOTE (its tree
 * identity is load-bearing — e.g. an append-only kinship edge, a subject tag on someone else's
 * retained story, a photo they contributed, a person they created). By the time this runs the
 * teardown has already emptied the tables that were solely this person's, so a hit here is a
 * genuine retained reference.
 */
async function personStillReferenced(tx: TxLike, personId: string): Promise<boolean> {
  const p = personId;
  return existsByRawQuery(
    tx,
    sql`
    SELECT 1 FROM kinship_assertions
      WHERE person_a_id = ${p} OR person_b_id = ${p} OR actor_person_id = ${p}
    UNION ALL SELECT 1 FROM kinship_subject_hides
      WHERE person_a_id = ${p} OR person_b_id = ${p} OR subject_person_id = ${p} OR actor_person_id = ${p}
    UNION ALL SELECT 1 FROM persons WHERE created_by_person_id = ${p}
    UNION ALL SELECT 1 FROM families WHERE creator_person_id = ${p} OR steward_person_id = ${p}
    UNION ALL SELECT 1 FROM memberships WHERE person_id = ${p}
    UNION ALL SELECT 1 FROM media WHERE owner_person_id = ${p}
    UNION ALL SELECT 1 FROM stories WHERE owner_person_id = ${p}
    UNION ALL SELECT 1 FROM prose_revisions WHERE actor_person_id = ${p}
    UNION ALL SELECT 1 FROM consent_records WHERE person_id = ${p} OR actor_person_id = ${p}
    UNION ALL SELECT 1 FROM asks WHERE asker_person_id = ${p} OR target_person_id = ${p}
    UNION ALL SELECT 1 FROM link_sessions WHERE person_id = ${p} OR invited_by_person_id = ${p}
    UNION ALL SELECT 1 FROM invitations
      WHERE inviter_person_id = ${p} OR invitee_person_id = ${p} OR accepted_person_id = ${p}
    UNION ALL SELECT 1 FROM join_requests WHERE requester_person_id = ${p} OR decided_by_person_id = ${p}
    UNION ALL SELECT 1 FROM google_photos_connections WHERE person_id = ${p}
    UNION ALL SELECT 1 FROM intake_answers WHERE person_id = ${p}
    UNION ALL SELECT 1 FROM intake_revisions WHERE actor_person_id = ${p}
    UNION ALL SELECT 1 FROM story_views WHERE person_id = ${p}
    UNION ALL SELECT 1 FROM story_favorites WHERE person_id = ${p}
    UNION ALL SELECT 1 FROM story_likes WHERE person_id = ${p}
    UNION ALL SELECT 1 FROM story_subjects WHERE person_id = ${p} OR tagged_by_person_id = ${p}
    UNION ALL SELECT 1 FROM story_images WHERE attached_by_person_id = ${p}
    UNION ALL SELECT 1 FROM family_photos WHERE contributor_person_id = ${p}
    UNION ALL SELECT 1 FROM voice_captions WHERE owner_person_id = ${p}
    UNION ALL SELECT 1 FROM photo_subjects WHERE person_id = ${p} OR tagged_by_person_id = ${p}
    UNION ALL SELECT 1 FROM photo_people WHERE person_id = ${p} OR tagged_by_person_id = ${p}
    UNION ALL SELECT 1 FROM photo_places WHERE tagged_by_person_id = ${p}
    UNION ALL SELECT 1 FROM places WHERE created_by_person_id = ${p}
    UNION ALL SELECT 1 FROM erasure_audit WHERE owner_person_id = ${p} OR actor_person_id = ${p}
    LIMIT 1
  `,
  );
}
