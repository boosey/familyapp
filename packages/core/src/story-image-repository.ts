/**
 * Story ACCOMPANIMENT write + read seam (ADR-0009 Phase 2) — the audited surface for the guarded
 * `story_images` table. "All rendering flows through `story_images`" (ADR-0009): the photos shown
 * ALONGSIDE a story to illustrate it — many per story, exactly one COVER, ordered by `position`.
 *
 * This file is on the architecture-test allowlist because it is the ONLY production code that WRITES
 * `story_images` (and reads it for rendering). Attaching / detaching / re-covering / reordering an
 * image writes NO `consent_records` row and needs no re-approval — images are mutable presentation
 * (ADR-0009 "Images are off the consent ledger"). A photo-byte read, by contrast, still funnels
 * through `album-repository.ts`'s `decideAlbumPhotoRead`, which honors the story audience.
 *
 * ACTOR AUTHORIZATION IS THE CALLER'S RESPONSIBILITY. Exactly like `setStoryFamilyTargets`
 * (story-repository.ts), the write primitives here take no `AuthContext`. They are owner-in-draft
 * mutations; the server action that invokes them MUST re-resolve auth and verify the actor owns the
 * draft story before calling. These functions validate DATA integrity (the photo exists, the id set
 * matches, one cover per story), not WHO is acting.
 *
 * The single-cover invariant is enforced in THREE places, defense-in-depth: (1) the partial unique
 * index `story_images_one_cover_uq WHERE is_cover` in invariants.sql (the structural backstop);
 * (2) `attachPhotoToStory` makes the FIRST image the cover; (3) `setStoryCover` clears every other
 * image's `is_cover` inside the same transaction before setting the target's.
 *
 * The reads EXCLUDE images whose family photo is soft-deleted — which is what realizes
 * "delete-a-photo cascades an un-attach everywhere it is used" at read time (the album delete is
 * SOFT, so the `family_photo_id` FK cascade never fires; the read filter makes the photo vanish).
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { familyPhotos, storyImages } from "@chronicle/db/content";
import type { Database, StoryImage } from "@chronicle/db";
import { InvariantViolation } from "./errors";
import { assertPersonCanAccessAlbumPhoto } from "./album-repository";

// ---------------------------------------------------------------------------
// Write primitives (ACTOR AUTHZ IS THE CALLER'S JOB). All multi-row writes are transactional.
// ---------------------------------------------------------------------------

/**
 * Attach an album photo to a story as accompaniment. Inserts a `family_photo`-provenance row at
 * `position = max(position) + 1` (0 if the story has none yet). If it is the story's FIRST image it
 * becomes the COVER. Idempotency is enforced by the `story_images_story_photo_uq` unique index —
 * a duplicate attach (same story + same photo) throws, and the caller maps that to a friendly error.
 *
 * Validates the photo EXISTS and is NOT soft-deleted (you cannot illustrate a story with a deleted
 * photo). Does NOT write `family_photo_families`: attach visibility is realized by the album read
 * seam's accompaniment arm (ADR-0009), not by extending album membership, in this slice.
 *
 * ALBUM-ACCESS GATE (ADR-0009 lines 33-34, "a photo never escapes into families the contributor has
 * not placed it in"): the attacher must already be able to SEE the photo via the album read model —
 * i.e. this is Arm 1 of `decideAlbumPhotoRead`, person-scoped (there is no AuthContext here; the
 * caller has re-resolved auth and passed the actor's `attachedByPersonId`). Without this check, the
 * broadened `decideAlbumPhotoRead` accompaniment arm would let any actor self-grant read access to
 * an arbitrary photo by attaching it to their own private draft (owner-ALLOW on their own story →
 * Arm 2 ALLOW). ALLOW iff the attacher is the photo's CONTRIBUTOR (may always attach their own
 * artifact, even after leaving a family — matching `decideAlbumPhotoManage`) OR holds an ACTIVE
 * membership in at least one family the photo is placed in. This validates DATA/visibility integrity;
 * gating WHO may act on the draft (owner/steward) remains the CALLER's responsibility.
 */
export async function attachPhotoToStory(
  db: Database,
  input: { storyId: string; familyPhotoId: string; attachedByPersonId: string },
): Promise<StoryImage> {
  return db.transaction((tx) => attachPhotoToStoryTx(tx, input));
}

/**
 * The transactional body of `attachPhotoToStory`, operating on a caller-supplied tx handle. Exported
 * so the story-creation write path (`createTextDraft` / `persistRecordingAndCreateDraft`) can insert
 * the subject photo's FIRST cover row IN THE SAME TRANSACTION as the story insert (ADR-0009 Phase 3
 * atomicity) — no second, non-atomic attach path. The album-access gate
 * (`assertPersonCanAccessAlbumPhoto`, which also enforces existence + not-soft-deleted) is the single
 * choke point, run BEFORE any insert; the actor is the caller's already-resolved `attachedByPersonId`.
 */
export async function attachPhotoToStoryTx(
  tx: Pick<Database, "select" | "insert">,
  input: { storyId: string; familyPhotoId: string; attachedByPersonId: string },
): Promise<StoryImage> {
  // Album-access gate (existence + soft-delete + contributor-or-member). See its JSDoc for the
  // self-grant attack it closes.
  await assertPersonCanAccessAlbumPhoto(tx, input.attachedByPersonId, input.familyPhotoId);

  // Highest existing position (rows may have gaps left by detaches; we append past the max).
  const [top] = await tx
    .select({ position: storyImages.position })
    .from(storyImages)
    .where(eq(storyImages.storyId, input.storyId))
    .orderBy(desc(storyImages.position))
    .limit(1);
  const isFirst = top === undefined;
  const nextPosition = isFirst ? 0 : top.position + 1;

  const [row] = await tx
    .insert(storyImages)
    .values({
      storyId: input.storyId,
      familyPhotoId: input.familyPhotoId,
      provenance: "family_photo",
      // First image on the story is the cover (there can be exactly one).
      isCover: isFirst,
      position: nextPosition,
      attachedByPersonId: input.attachedByPersonId,
    })
    .returning();
  return row!;
}

/**
 * Detach (delete) an image from a story, scoped to `storyId` so a caller can't detach another
 * story's image by id. If the removed image was the COVER and other images remain, the
 * lowest-`position` remaining image is promoted to cover (so a story with images always has one).
 * `position` gaps are left as-is — order is preserved and re-derivable from the remaining positions.
 * No-op (returns quietly) if no row matches.
 */
export async function detachStoryImage(
  db: Database,
  input: { storyId: string; storyImageId: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(storyImages)
      .where(
        and(
          eq(storyImages.id, input.storyImageId),
          eq(storyImages.storyId, input.storyId),
        ),
      )
      .returning({ isCover: storyImages.isCover });
    if (!removed) return; // nothing matched — no-op
    if (!removed.isCover) return; // removing a non-cover leaves the existing cover intact

    // Promote the lowest-position survivor (if any) to cover.
    const [next] = await tx
      .select({ id: storyImages.id })
      .from(storyImages)
      .where(eq(storyImages.storyId, input.storyId))
      .orderBy(asc(storyImages.position))
      .limit(1);
    if (next) {
      await tx
        .update(storyImages)
        .set({ isCover: true })
        .where(eq(storyImages.id, next.id));
    }
  });
}

/**
 * Make `storyImageId` the story's cover. In one transaction: clear `is_cover` on every image of the
 * story, then set it on the target. Clearing FIRST keeps the `story_images_one_cover_uq` partial
 * unique index satisfied at every statement boundary (two covers never coexist). No-op-safe: setting
 * the already-cover image re-sets the same state. Throws if the target is not attached to the story
 * (so the story is never left cover-less by a bad id).
 */
export async function setStoryCover(
  db: Database,
  input: { storyId: string; storyImageId: string },
): Promise<void> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: storyImages.id })
      .from(storyImages)
      .where(
        and(
          eq(storyImages.id, input.storyImageId),
          eq(storyImages.storyId, input.storyId),
        ),
      )
      .limit(1);
    if (!target) {
      throw new InvariantViolation(
        `setStoryCover: image ${input.storyImageId} is not attached to story ${input.storyId}`,
      );
    }
    await tx
      .update(storyImages)
      .set({ isCover: false })
      .where(
        and(
          eq(storyImages.storyId, input.storyId),
          eq(storyImages.isCover, true),
        ),
      );
    await tx
      .update(storyImages)
      .set({ isCover: true })
      .where(eq(storyImages.id, input.storyImageId));
  });
}

/**
 * Rewrite the `position` of a story's images to match `orderedStoryImageIds`. Mirrors
 * `setStoryFamilyTargets`' replace-set discipline: the given id set must EXACTLY match the story's
 * current image ids (no missing, no extra, no duplicates) — otherwise `InvariantViolation`. Does not
 * touch `is_cover` (the cover is order-independent). Two-pass within the transaction — park every row
 * at a negative temp position first, then write the final 0-based positions — so the intermediate
 * writes never collide with the `(story_id, position)` unique index.
 */
export async function reorderStoryImages(
  db: Database,
  input: { storyId: string; orderedStoryImageIds: string[] },
): Promise<void> {
  const ordered = input.orderedStoryImageIds;
  const unique = [...new Set(ordered)];
  if (unique.length !== ordered.length) {
    throw new InvariantViolation(
      "reorderStoryImages: the requested order contains duplicate image ids",
    );
  }
  return db.transaction(async (tx) => {
    const current = await tx
      .select({ id: storyImages.id })
      .from(storyImages)
      .where(eq(storyImages.storyId, input.storyId));
    const currentIds = new Set(current.map((r) => r.id));
    if (
      currentIds.size !== unique.length ||
      !unique.every((id) => currentIds.has(id))
    ) {
      throw new InvariantViolation(
        `reorderStoryImages: the requested order must be exactly the story ${input.storyId}'s current image set`,
      );
    }
    // Pass 1: park at negative temp positions (existing positions are >= 0, so no collision).
    for (let i = 0; i < unique.length; i++) {
      await tx
        .update(storyImages)
        .set({ position: -(i + 1) })
        .where(eq(storyImages.id, unique[i]!));
    }
    // Pass 2: write the final 0-based positions.
    for (let i = 0; i < unique.length; i++) {
      await tx
        .update(storyImages)
        .set({ position: i })
        .where(eq(storyImages.id, unique[i]!));
    }
  });
}

// ---------------------------------------------------------------------------
// Reads (system-actor / caller-gated — the CALLER gates the parent story via getStoryForViewer
// FIRST; ADR-0009 says an attachment link is visible only when its story is). Every read EXCLUDES
// images whose family photo is soft-deleted — that is how a deleted photo disappears from every
// story it was on (the album delete is soft, so the FK cascade never fires).
// ---------------------------------------------------------------------------

/** A rendered accompaniment image — the fields the gallery + cover need, no more. */
export interface StoryImageView {
  id: string;
  familyPhotoId: string | null;
  provenance: StoryImage["provenance"];
  isCover: boolean;
  position: number;
  /** The family photo's caption (doubles as alt text). Null for an illustration or no caption. */
  caption: string | null;
}

/**
 * The story's images in render order (`position` asc), EXCLUDING any whose family photo is
 * soft-deleted. A LEFT join keeps future inline illustrations (`family_photo_id` NULL) — for those
 * the join yields NULL and the `deletedAt IS NULL` filter passes; only a genuinely soft-deleted
 * album photo is dropped.
 */
export async function listStoryImages(
  db: Database,
  storyId: string,
): Promise<StoryImageView[]> {
  return db
    .select({
      id: storyImages.id,
      familyPhotoId: storyImages.familyPhotoId,
      provenance: storyImages.provenance,
      isCover: storyImages.isCover,
      position: storyImages.position,
      caption: familyPhotos.caption,
    })
    .from(storyImages)
    .leftJoin(familyPhotos, eq(familyPhotos.id, storyImages.familyPhotoId))
    .where(and(eq(storyImages.storyId, storyId), isNull(familyPhotos.deletedAt)))
    .orderBy(asc(storyImages.position));
}

/**
 * The `family_photo_id` of the story's cover — the explicit cover image, or, if none survives, the
 * lowest-`position` image. Soft-deleted photos are excluded (so a deleted cover falls through to the
 * next image). Returns null if the story has no renderable image. Ordering by `is_cover` desc then
 * `position` asc puts the cover first, else the lowest position.
 */
export async function getStoryCoverPhotoId(
  db: Database,
  storyId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ familyPhotoId: storyImages.familyPhotoId })
    .from(storyImages)
    .leftJoin(familyPhotos, eq(familyPhotos.id, storyImages.familyPhotoId))
    .where(and(eq(storyImages.storyId, storyId), isNull(familyPhotos.deletedAt)))
    .orderBy(desc(storyImages.isCover), asc(storyImages.position))
    .limit(1);
  return row?.familyPhotoId ?? null;
}

/**
 * Batched cover lookup for the feed (mirrors `loadStoryFamilyTargets`): `storyId → coverPhotoId`,
 * with the same soft-delete exclusion as `getStoryCoverPhotoId`. A story with no renderable image
 * (or whose cover is a photo-less illustration) simply has no map entry. One query; the per-story
 * winner is the first row in the global `(is_cover desc, position asc)` order.
 */
export async function loadStoryCovers(
  db: Database,
  storyIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(storyIds)];
  if (unique.length === 0) return result;

  const rows = await db
    .select({
      storyId: storyImages.storyId,
      familyPhotoId: storyImages.familyPhotoId,
    })
    .from(storyImages)
    .leftJoin(familyPhotos, eq(familyPhotos.id, storyImages.familyPhotoId))
    .where(
      and(inArray(storyImages.storyId, unique), isNull(familyPhotos.deletedAt)),
    )
    .orderBy(desc(storyImages.isCover), asc(storyImages.position));

  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.storyId)) continue; // first per story = cover-or-lowest (ordered above)
    seen.add(r.storyId);
    if (r.familyPhotoId !== null) result.set(r.storyId, r.familyPhotoId);
  }
  return result;
}

/**
 * Batched GALLERY lookup for the feed (sibling of `loadStoryCovers`): `storyId → [photoId, …]` — ALL
 * renderable photo ids for each story in render order (cover first, then `position` asc), with the same
 * soft-delete exclusion. Where `loadStoryCovers` keeps only the winning cover, this keeps the whole
 * ordered set, so the caller can render the cover big and the remaining (non-cover) photos as a small
 * thumbnail row. A story with no renderable image (or only photo-less illustrations) has no map entry.
 * One query; the global `(is_cover desc, position asc)` order makes each story's first id its cover.
 */
export async function loadStoryGalleryPhotoIds(
  db: Database,
  storyIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const unique = [...new Set(storyIds)];
  if (unique.length === 0) return result;

  const rows = await db
    .select({
      storyId: storyImages.storyId,
      familyPhotoId: storyImages.familyPhotoId,
    })
    .from(storyImages)
    .leftJoin(familyPhotos, eq(familyPhotos.id, storyImages.familyPhotoId))
    .where(
      and(inArray(storyImages.storyId, unique), isNull(familyPhotos.deletedAt)),
    )
    .orderBy(desc(storyImages.isCover), asc(storyImages.position));

  for (const r of rows) {
    if (r.familyPhotoId === null) continue; // photo-less illustration — nothing to render yet
    const arr = result.get(r.storyId);
    if (arr) arr.push(r.familyPhotoId);
    else result.set(r.storyId, [r.familyPhotoId]);
  }
  return result;
}
