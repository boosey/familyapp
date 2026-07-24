/**
 * The album write + read front door (ADR-0009 · #15). Together with `story-image-repository.ts` this
 * is the audited surface for the guarded `family_photos` / `family_photo_families` tables — keeping
 * every album content read AND write in a tiny, auditable surface, exactly as authorization.ts /
 * story-repository.ts do for stories/media. It is on the architecture-test allowlist for precisely
 * that reason. The photo-byte read decision also reads `stories` + `story_images` (both guarded) to
 * realize the ADR-0009 accompaniment rule: a photo attached to a story the viewer may read is
 * itself readable (see `decideAlbumPhotoRead`).
 *
 * The album's authorization model is deliberately SIMPLER than a Story's. A photo has a
 * CONTRIBUTOR, not an owner, and "being in a family's album IS the contributor's consent for that
 * family to see it" (ADR-0009). So visibility is not a tier × state × consent-ledger computation —
 * it is a single question: does the viewer hold an ACTIVE membership in ANY family the (non-deleted)
 * photo is placed in? The active-membership check mirrors authorization.ts's `activeFamilyIds`.
 *
 * Scope note (#15): single-family placement + no EXIF population. The `familyIds` array and the
 * exif fields on the input already exist because they are the shared contract #16 (multi-family
 * picker) and #17 (EXIF at import) build on — this file writes whatever it is handed.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  familyPhotoFamilies,
  familyPhotos,
  photoPeople,
  photoPlaces,
  photoSubjects,
  places,
  stories,
  storyImages,
} from "@chronicle/db/content";
import { families, memberships, persons } from "@chronicle/db/schema";
import type { Database, FamilyPhoto, PhotoSource } from "@chronicle/db";
import {
  type AuthContext,
  type AuthDecision,
  decideStoryRead,
  viewerPersonId,
} from "./authorization";
import { InvariantViolation } from "./errors";
import { ALBUM_PHOTO_QUERY_CAP } from "./constants";

const DENY = (reason: string): AuthDecision => ({ allowed: false, reason });
const ALLOW: AuthDecision = { allowed: true };

/**
 * Family ids in which the person currently holds an ACTIVE membership. Mirrors the identical helper
 * in authorization.ts (memberships is an open, freely-importable authz input) — the album reuses the
 * exact same active-membership semantics as Story visibility.
 */
async function activeFamilyIds(
  db: Pick<Database, "select">,
  personId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(
      and(eq(memberships.personId, personId), eq(memberships.status, "active")),
    );
  return new Set(rows.map((r) => r.familyId));
}

/**
 * Assert `personId` may SEE album photo `photoId` under the album read model — the SINGLE choke point
 * reused by every write that references a photo by id (attach-to-story, the subject-cover insert at
 * story creation, and Ask subject-photo targeting). Throws `InvariantViolation` if the photo does not
 * exist / is soft-deleted, OR if the person is NEITHER its contributor NOR an active member of any
 * family the photo is placed in. This is Arm 1 of `decideAlbumPhotoRead`, person-scoped (there is no
 * AuthContext — the caller has re-resolved auth and passes the actor's `personId`).
 *
 * WHY IT MUST BE A GATE (adversarial): without it, a caller could self-grant read access to an
 * arbitrary photo by referencing it (e.g. attaching it to their OWN private draft, whose owner-ALLOW
 * would then satisfy the accompaniment read arm of `decideAlbumPhotoRead`). The contributor is
 * authorized regardless of current membership (they may always reference their own artifact — matching
 * `decideAlbumPhotoManage`). Accepts a `Pick<Database, "select">` so it runs inside a caller's
 * transaction handle as well as on a plain db.
 */
export async function assertPersonCanAccessAlbumPhoto(
  db: Pick<Database, "select">,
  personId: string,
  photoId: string,
): Promise<void> {
  const [photo] = await db
    .select({
      id: familyPhotos.id,
      contributorPersonId: familyPhotos.contributorPersonId,
      deletedAt: familyPhotos.deletedAt,
    })
    .from(familyPhotos)
    .where(eq(familyPhotos.id, photoId))
    .limit(1);
  if (!photo || photo.deletedAt !== null) {
    throw new InvariantViolation(
      `album photo ${photoId} does not exist or has been deleted`,
    );
  }
  // The contributor may always reference their own photo.
  if (photo.contributorPersonId === personId) return;
  // Otherwise the person must hold an ACTIVE membership in a family the photo is placed in. One query
  // intersects the photo's placements with the person's active memberships — non-empty ⇒ they can see it.
  const [shared] = await db
    .select({ familyId: familyPhotoFamilies.familyId })
    .from(familyPhotoFamilies)
    .innerJoin(
      memberships,
      and(
        eq(memberships.familyId, familyPhotoFamilies.familyId),
        eq(memberships.personId, personId),
        eq(memberships.status, "active"),
      ),
    )
    .where(eq(familyPhotoFamilies.photoId, photoId))
    .limit(1);
  if (!shared) {
    throw new InvariantViolation(
      `person ${personId} cannot access album photo ${photoId} — they are neither its ` +
        `contributor nor an active member of any family it is placed in`,
    );
  }
}

export interface CreateAlbumPhotoInput {
  /** The contributor (a photo has a contributor, not an owner). */
  contributorPersonId: string;
  /** The target family albums — >=1. #15 always passes exactly one; #16 passes several. */
  familyIds: string[];
  source: PhotoSource;
  /** Object-storage key (`family-photos/<uuid>`); the bytes are already written there (write-once). */
  storageKey: string;
  /** Contributor-authored label; doubles as alt text. Null/omitted ⇒ no caption. */
  caption?: string | null;
  /** EXIF capture time (#17 populates; #15 passes null/omits). */
  exifCapturedAt?: Date | null;
  /** EXIF GPS (#17 populates; #15 passes null/omits). */
  exifGps?: { lat: number; lng: number } | null;
}

/**
 * Insert the `family_photos` row plus one `family_photo_families` membership row per target family,
 * in ONE transaction (a photo is never half-placed). Duplicate family ids are de-duped to respect
 * the (photo_id, family_id) composite PK. Requires >=1 family — a photo that lives in no album has
 * no consent to be seen by anyone, which is not a state this repo will create.
 */
export async function createAlbumPhoto(
  db: Database,
  input: CreateAlbumPhotoInput,
): Promise<FamilyPhoto> {
  const familyIds = [...new Set(input.familyIds)];
  if (familyIds.length === 0) {
    throw new InvariantViolation(
      "an album photo must be placed in at least one family album",
    );
  }
  return db.transaction(async (tx) => {
    const [photo] = await tx
      .insert(familyPhotos)
      .values({
        contributorPersonId: input.contributorPersonId,
        source: input.source,
        storageKey: input.storageKey,
        caption: input.caption ?? null,
        exifCapturedAt: input.exifCapturedAt ?? null,
        exifGps: input.exifGps ?? null,
      })
      .returning();
    await tx
      .insert(familyPhotoFamilies)
      .values(familyIds.map((familyId) => ({ photoId: photo!.id, familyId })));
    return photo!;
  });
}

/**
 * EVERY `family_photos.storage_key` — INCLUDING soft-deleted rows, whose bytes are deliberately
 * retained today (soft delete removes the photo from every surface but does not destroy the
 * object), so they still count as references. This is the orphaned-object reaper's (#90)
 * referenced-keys read: a system-actor content read with no `AuthContext`, deliberately exported
 * ONLY via the `@chronicle/core/pipeline` subpath (never the package root), same discipline as
 * the pipeline's other system-actor reads.
 */
export async function listAlbumPhotoStorageKeys(
  db: Pick<Database, "select">,
): Promise<string[]> {
  const rows = await db
    .select({ storageKey: familyPhotos.storageKey })
    .from(familyPhotos);
  return rows.map((r) => r.storageKey);
}

/** A photo as shown in an album grid — the fields the grid + bytes route need, no more. */
export interface AlbumPhotoView {
  id: string;
  contributorPersonId: string;
  source: PhotoSource;
  storageKey: string;
  caption: string | null;
  exifCapturedAt: Date | null;
  createdAt: Date;
}

/** Options for the album reads (issue #217). */
export interface ListAlbumPhotosOptions {
  /**
   * Defensive cap on rows returned (most-recent first). Defaults to `ALBUM_PHOTO_QUERY_CAP`. This is
   * a safety net against a runaway album, not pagination — the tail is silently dropped.
   */
  limit?: number;
}

/**
 * The photos in `familyId`'s album, most-recent first, EXCLUDING soft-deleted rows, capped at
 * `opts.limit` (default `ALBUM_PHOTO_QUERY_CAP`, #217). The viewer must hold an ACTIVE membership in
 * `familyId`; a non-member (or anonymous) viewer gets an empty list (an album never leaks to someone
 * who isn't in the family).
 */
export async function listAlbumPhotos(
  db: Database,
  ctx: AuthContext,
  familyId: string,
  opts: ListAlbumPhotosOptions = {},
): Promise<AlbumPhotoView[]> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) return [];
  const viewerFamilies = await activeFamilyIds(db, viewer);
  if (!viewerFamilies.has(familyId)) return [];

  return db
    .select({
      id: familyPhotos.id,
      contributorPersonId: familyPhotos.contributorPersonId,
      source: familyPhotos.source,
      storageKey: familyPhotos.storageKey,
      caption: familyPhotos.caption,
      exifCapturedAt: familyPhotos.exifCapturedAt,
      createdAt: familyPhotos.createdAt,
    })
    .from(familyPhotos)
    .innerJoin(
      familyPhotoFamilies,
      eq(familyPhotoFamilies.photoId, familyPhotos.id),
    )
    .where(
      and(
        eq(familyPhotoFamilies.familyId, familyId),
        isNull(familyPhotos.deletedAt),
      ),
    )
    .orderBy(desc(familyPhotos.createdAt), desc(familyPhotos.id))
    .limit(opts.limit ?? ALBUM_PHOTO_QUERY_CAP);
}

/**
 * A photo enriched for the album List view (album enhancements, Phase C): the base grid fields plus
 * contributor name, its placements AMONG the viewer-authorized families, and its tag groups. Deliberately
 * OMITS `canManage` (the surface computes that from steward lookups it already holds) and the storageKey
 * (not needed for a list row). `families` reflects only the (viewer-authorized) subset of the photo's
 * placements — never a leak of a family the viewer isn't in.
 */
export interface AlbumPhotoDetailedRow {
  id: string;
  caption: string | null;
  contributorPersonId: string;
  contributorDisplayName: string | null;
  createdAt: Date;
  /** exifCapturedAt — the original capture time when EXIF carried one, else null. */
  capturedAt: Date | null;
  families: { familyId: string; familyName: string; familyShortName: string | null }[];
  subjects: { personId: string; displayName: string | null }[];
  people: { personId: string; displayName: string | null }[];
  places: { placeId: string; name: string }[];
}

/**
 * The photos across MANY family albums, enriched + deduped, for the album List view. Mirrors
 * `listAlbumPhotos`'s membership gating but over a SET of families and with joins collapsed in memory:
 *
 *   - The viewer must hold an ACTIVE membership in a family to see its photos. Any `familyIds` the
 *     viewer is NOT an active member of are silently dropped (never leaked). Anonymous ⇒ [].
 *   - Each non-deleted photo placed in ANY of those authorized families is returned ONCE (deduped by
 *     photo id), most-recent first (`createdAt` desc, then id desc).
 *   - `families` on each row lists only the AUTHORIZED placements (the intersection of the photo's
 *     placements with `authorizedFamilies`) — so a photo also placed in a family the viewer isn't in
 *     never reveals that family here.
 *
 * Efficiency: NO per-photo round-trips. One query fetches the placement rows for the authorized
 * families (yielding the photo id set + each photo's authorized placements). Then a fixed number of
 * GROUPED queries (photos, contributor names, family names, subjects, people, places) filtered by
 * `IN (photoIds)` are stitched in memory. Total ≈ 7 queries regardless of photo count.
 *
 * Defensively capped at `opts.limit` (default `ALBUM_PHOTO_QUERY_CAP`, #217): the most-recent N
 * distinct photos, tail dropped. A safety net against a runaway album, not pagination.
 */
export interface ListAlbumPhotosDetailedOptions {
  /** Defensive cap on distinct photos returned (most-recent first). Defaults to `ALBUM_PHOTO_QUERY_CAP`. */
  limit?: number;
}

export async function listAlbumPhotosDetailed(
  db: Database,
  ctx: AuthContext,
  familyIds: string[],
  opts: ListAlbumPhotosDetailedOptions = {},
): Promise<AlbumPhotoDetailedRow[]> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) return [];
  const viewerFamilies = await activeFamilyIds(db, viewer);
  // Only families the viewer is an active member of AND asked for (deduped).
  const authorizedFamilies = [
    ...new Set(familyIds.filter((id) => viewerFamilies.has(id))),
  ];
  if (authorizedFamilies.length === 0) return [];

  // (1) Placement rows for the authorized families, joined to non-deleted photos. Yields the photo id
  // set AND each photo's authorized placements (family id + name) in one pass. Ordered most-recent
  // first (by the photo's createdAt, id as tiebreak) so the #217 cap below keeps the newest photos.
  const placementRows = await db
    .select({
      photoId: familyPhotoFamilies.photoId,
      familyId: families.id,
      familyName: families.name,
      familyShortName: families.shortName,
      photoCreatedAt: familyPhotos.createdAt,
    })
    .from(familyPhotoFamilies)
    .innerJoin(families, eq(families.id, familyPhotoFamilies.familyId))
    .innerJoin(familyPhotos, eq(familyPhotos.id, familyPhotoFamilies.photoId))
    .where(
      and(
        inArray(familyPhotoFamilies.familyId, authorizedFamilies),
        isNull(familyPhotos.deletedAt),
      ),
    )
    .orderBy(desc(familyPhotos.createdAt), desc(familyPhotos.id));

  // Distinct photo ids in most-recent-first order, then DEFENSIVELY CAPPED (#217): a runaway album
  // never sends more than `limit` rows downstream (grouped queries + payload + DOM). The tail is
  // dropped, matching `photoRows`' `createdAt desc, id desc` ordering exactly so the kept set is
  // stable. Under the cap (every real album today) this is identical to the old dedup.
  const limit = opts.limit ?? ALBUM_PHOTO_QUERY_CAP;
  const orderedPhotoIds: string[] = [];
  const seenPhotoIds = new Set<string>();
  for (const r of placementRows) {
    if (seenPhotoIds.has(r.photoId)) continue;
    seenPhotoIds.add(r.photoId);
    orderedPhotoIds.push(r.photoId);
  }
  const photoIds = orderedPhotoIds.slice(0, limit);
  if (photoIds.length === 0) return [];
  const keptPhotoIds = new Set(photoIds);

  // Authorized placements per (kept) photo (sorted by family name for stable ordering).
  const familiesByPhoto = new Map<
    string,
    { familyId: string; familyName: string; familyShortName: string | null }[]
  >();
  for (const r of placementRows) {
    if (!keptPhotoIds.has(r.photoId)) continue;
    const list = familiesByPhoto.get(r.photoId) ?? [];
    list.push({ familyId: r.familyId, familyName: r.familyName, familyShortName: r.familyShortName });
    familiesByPhoto.set(r.photoId, list);
  }
  for (const list of familiesByPhoto.values()) {
    list.sort((a, b) => a.familyName.localeCompare(b.familyName));
  }

  // (2) The photos themselves (base fields), most-recent first.
  const photoRows = await db
    .select({
      id: familyPhotos.id,
      caption: familyPhotos.caption,
      contributorPersonId: familyPhotos.contributorPersonId,
      createdAt: familyPhotos.createdAt,
      capturedAt: familyPhotos.exifCapturedAt,
    })
    .from(familyPhotos)
    .where(inArray(familyPhotos.id, photoIds))
    .orderBy(desc(familyPhotos.createdAt), desc(familyPhotos.id));

  // (3) Contributor display names (one grouped lookup over the distinct contributor ids).
  const contributorIds = [...new Set(photoRows.map((p) => p.contributorPersonId))];
  const contributorRows = contributorIds.length
    ? await db
        .select({ id: persons.id, displayName: persons.displayName })
        .from(persons)
        .where(inArray(persons.id, contributorIds))
    : [];
  const contributorName = new Map(contributorRows.map((c) => [c.id, c.displayName]));

  // (4)+(5) Subjects + appears-in people, each a single grouped query joined to persons.
  const personTagsByPhoto = async (
    table: typeof photoSubjects | typeof photoPeople,
  ): Promise<Map<string, { personId: string; displayName: string | null }[]>> => {
    const rows = await db
      .select({
        photoId: table.photoId,
        personId: table.personId,
        displayName: persons.displayName,
        createdAt: table.createdAt,
      })
      .from(table)
      .innerJoin(persons, eq(persons.id, table.personId))
      .where(inArray(table.photoId, photoIds))
      .orderBy(asc(table.createdAt));
    const byPhoto = new Map<string, { personId: string; displayName: string | null }[]>();
    for (const r of rows) {
      const list = byPhoto.get(r.photoId) ?? [];
      list.push({ personId: r.personId, displayName: r.displayName });
      byPhoto.set(r.photoId, list);
    }
    return byPhoto;
  };
  const [subjectsByPhoto, peopleByPhoto] = await Promise.all([
    personTagsByPhoto(photoSubjects),
    personTagsByPhoto(photoPeople),
  ]);

  // (6) Places — one grouped query joined to `places`.
  const placeRows = await db
    .select({
      photoId: photoPlaces.photoId,
      placeId: places.id,
      name: places.name,
      createdAt: photoPlaces.createdAt,
    })
    .from(photoPlaces)
    .innerJoin(places, eq(places.id, photoPlaces.placeId))
    .where(inArray(photoPlaces.photoId, photoIds))
    .orderBy(asc(photoPlaces.createdAt));
  const placesByPhoto = new Map<string, { placeId: string; name: string }[]>();
  for (const r of placeRows) {
    const list = placesByPhoto.get(r.photoId) ?? [];
    list.push({ placeId: r.placeId, name: r.name });
    placesByPhoto.set(r.photoId, list);
  }

  // Stitch. `photoRows` already carries the deduped, most-recent-first ordering.
  return photoRows.map((p) => ({
    id: p.id,
    caption: p.caption,
    contributorPersonId: p.contributorPersonId,
    contributorDisplayName: contributorName.get(p.contributorPersonId) ?? null,
    createdAt: p.createdAt,
    capturedAt: p.capturedAt,
    families: familiesByPhoto.get(p.id) ?? [],
    subjects: subjectsByPhoto.get(p.id) ?? [],
    people: peopleByPhoto.get(p.id) ?? [],
    places: placesByPhoto.get(p.id) ?? [],
  }));
}

/**
 * The album's photo IDS ONLY, across MANY family albums — the lightweight sibling of
 * `listAlbumPhotosDetailed` used to WARM thumbnail caches on hub load (#371). Same authorization and
 * ordering, but it returns nothing but ids so it can run cheaply on EVERY hub render (not just when
 * the album tab is active):
 *
 *   - The viewer must hold an ACTIVE membership in a family to see its photos; any `familyIds` the
 *     viewer is NOT an active member of are silently dropped (never leaked). Anonymous ⇒ [].
 *   - Each non-deleted photo placed in ANY authorized family appears ONCE (deduped by id), most-recent
 *     first (`createdAt` desc, id desc) — the SAME ordering `listAlbumPhotosDetailed` uses, so a warmed
 *     prefix is exactly the prefix of tiles the album will render.
 *   - Defensively capped at `opts.limit` (default `ALBUM_PHOTO_QUERY_CAP`) — callers warming a single
 *     screenful pass a small limit.
 *
 * Efficiency: ONE query (the placement rows joined to non-deleted photos), deduped in memory. No
 * enrichment (no contributor/family/tag joins) — warming needs only the ids to build the byte-route URLs.
 */
export async function listAlbumPhotoIds(
  db: Database,
  ctx: AuthContext,
  familyIds: string[],
  opts: ListAlbumPhotosDetailedOptions = {},
): Promise<string[]> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) return [];
  const viewerFamilies = await activeFamilyIds(db, viewer);
  const authorizedFamilies = [
    ...new Set(familyIds.filter((id) => viewerFamilies.has(id))),
  ];
  if (authorizedFamilies.length === 0) return [];

  // Placement rows for the authorized families, joined to non-deleted photos, most-recent first.
  const placementRows = await db
    .select({
      photoId: familyPhotoFamilies.photoId,
    })
    .from(familyPhotoFamilies)
    .innerJoin(familyPhotos, eq(familyPhotos.id, familyPhotoFamilies.photoId))
    .where(
      and(
        inArray(familyPhotoFamilies.familyId, authorizedFamilies),
        isNull(familyPhotos.deletedAt),
      ),
    )
    .orderBy(desc(familyPhotos.createdAt), desc(familyPhotos.id));

  // Distinct photo ids in most-recent-first order, then defensively capped (#217). A photo placed in
  // several authorized families yields several rows; count the DISTINCT photo, not the placement rows.
  const limit = opts.limit ?? ALBUM_PHOTO_QUERY_CAP;
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const r of placementRows) {
    if (seen.has(r.photoId)) continue;
    seen.add(r.photoId);
    ordered.push(r.photoId);
  }
  return ordered.slice(0, limit);
}

/** A photo as shown on the person page's "Photos contributed" grid — thumbnail/metadata refs only. */
export interface AlbumPhotoCard {
  id: string;
  caption: string | null;
  contributorPersonId: string;
  createdAt: Date;
  /** exifCapturedAt — the original capture time when EXIF carried one, else null. */
  capturedAt: Date | null;
  /** The AUTHORIZED album placements (families the viewer is also an active member of). Never leaks. */
  families: { familyId: string; familyName: string }[];
}

/**
 * "Photos contributed by X" (tree Slice B) — the album photos this Person CONTRIBUTED
 * (`family_photos.contributorPersonId = personId`), SCOPED to the viewer's authorized albums. This
 * reuses the exact album read model as `listAlbumPhotosDetailed`: a photo is returned ONLY if it is
 * placed in a family the VIEWER holds an ACTIVE membership in. The contributor filter only NARROWS —
 * it NEVER grants: a photo the contributor placed solely in a family the viewer isn't in never
 * appears, and there is deliberately NO contributor-bypass here (unlike the reference/manage paths,
 * where a contributor may always touch their own artifact — this is a READ surface for a THIRD-party
 * viewer, so it is membership-gated end to end). An anonymous viewer (no memberships) gets []. Media
 * bytes stay behind the storage seam — only thumbnail/metadata refs are returned.
 *
 * Efficiency: one placement query (photo id set ∩ authorized families + authorized placements),
 * then one grouped query for the photo base fields. `families` on each row is the intersection of
 * the photo's placements with the viewer's authorized families — never a leak of a family the viewer
 * isn't in. Deduped by photo id, most-recent first (`createdAt` desc, then id desc).
 */
export async function listPhotosContributedByPerson(
  db: Database,
  ctx: AuthContext,
  personId: string,
): Promise<AlbumPhotoCard[]> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) return [];
  const viewerFamilies = await activeFamilyIds(db, viewer);
  if (viewerFamilies.size === 0) return [];
  const authorizedFamilies = [...viewerFamilies];

  // (1) Placement rows: the CONTRIBUTOR's non-deleted photos placed in a family the VIEWER may see.
  // Yields the authorized photo id set AND each photo's authorized (viewer-visible) placements.
  const placementRows = await db
    .select({
      photoId: familyPhotoFamilies.photoId,
      familyId: families.id,
      familyName: families.name,
    })
    .from(familyPhotoFamilies)
    .innerJoin(families, eq(families.id, familyPhotoFamilies.familyId))
    .innerJoin(familyPhotos, eq(familyPhotos.id, familyPhotoFamilies.photoId))
    .where(
      and(
        inArray(familyPhotoFamilies.familyId, authorizedFamilies),
        eq(familyPhotos.contributorPersonId, personId),
        isNull(familyPhotos.deletedAt),
      ),
    );

  const photoIds = [...new Set(placementRows.map((r) => r.photoId))];
  if (photoIds.length === 0) return [];

  const familiesByPhoto = new Map<string, { familyId: string; familyName: string }[]>();
  for (const r of placementRows) {
    const list = familiesByPhoto.get(r.photoId) ?? [];
    list.push({ familyId: r.familyId, familyName: r.familyName });
    familiesByPhoto.set(r.photoId, list);
  }
  for (const list of familiesByPhoto.values()) {
    list.sort((a, b) => a.familyName.localeCompare(b.familyName));
  }

  // (2) The photos themselves (base fields), most-recent first.
  const photoRows = await db
    .select({
      id: familyPhotos.id,
      caption: familyPhotos.caption,
      contributorPersonId: familyPhotos.contributorPersonId,
      createdAt: familyPhotos.createdAt,
      capturedAt: familyPhotos.exifCapturedAt,
    })
    .from(familyPhotos)
    .where(inArray(familyPhotos.id, photoIds))
    .orderBy(desc(familyPhotos.createdAt), desc(familyPhotos.id));

  return photoRows.map((p) => ({
    id: p.id,
    caption: p.caption,
    contributorPersonId: p.contributorPersonId,
    createdAt: p.createdAt,
    capturedAt: p.capturedAt,
    families: familiesByPhoto.get(p.id) ?? [],
  }));
}

/**
 * The single album-read decision, given an already-fetched photo (or its absence). Photo-byte
 * visibility (ADR-0009 §Authorization) is the UNION of two arms — mirroring `decideMediaRead`
 * (authorization.ts): a media asset is readable by its owner OR as the recording of any story the
 * viewer may read; a photo is readable via its album memberships OR as the accompaniment of any
 * story the viewer may read.
 *
 *   - Arm 1 (album): ALLOW iff the viewer shares an ACTIVE membership in ANY family the photo is
 *     placed in. No owner/contributor bypass — the contributor is authorized only by virtue of
 *     still being an active member of a family the photo is in.
 *   - Arm 2 (accompaniment, ADR-0009): ALLOW iff the photo is attached (`story_images`) to a story
 *     the viewer may read via `decideStoryRead`. A `private` story leaks nothing (decideStoryRead
 *     denies it); a `public` story serves its imagery to anyone — INCLUDING anonymous viewers.
 *
 * There is deliberately NO early anonymous-deny: an anon simply holds no album memberships (Arm 1
 * finds nothing) and is judged purely on the story audience (Arm 2) — a photo on a public story is
 * public. A soft-deleted or non-existent photo is treated as ABSENT and DENIED to EVERYONE up front
 * (this realizes "delete-a-photo cascades an un-attach everywhere" at read time — the album delete
 * is SOFT, so the FK cascade never fires; this DENY is what makes the photo vanish from every story
 * it was on). Both public entry points funnel through this, so there is exactly ONE decision.
 */
async function decideAlbumPhotoRead(
  db: Database,
  ctx: AuthContext,
  photo: Pick<FamilyPhoto, "id" | "deletedAt"> | undefined,
): Promise<AuthDecision> {
  // Absent / soft-deleted ⇒ denied to everyone (story audience included). Stays FIRST.
  if (!photo || photo.deletedAt !== null) {
    return DENY("photo does not exist or has been deleted");
  }
  const viewer = viewerPersonId(ctx);

  // Arm 1 — album membership. (Anonymous viewers hold none; they fall through to Arm 2.)
  if (viewer !== null) {
    const placements = await db
      .select({ familyId: familyPhotoFamilies.familyId })
      .from(familyPhotoFamilies)
      .where(eq(familyPhotoFamilies.photoId, photo.id));
    const viewerFamilies = await activeFamilyIds(db, viewer);
    for (const { familyId } of placements) {
      if (viewerFamilies.has(familyId)) return ALLOW;
    }
  }

  // Arm 2 — accompaniment audience. Load the stories this photo is attached to and defer each to
  // the single Story front door; if the viewer may read ANY of them, the photo is readable.
  const attachedStories = await db
    .select({
      id: stories.id,
      ownerPersonId: stories.ownerPersonId,
      state: stories.state,
      audienceTier: stories.audienceTier,
    })
    .from(storyImages)
    .innerJoin(stories, eq(stories.id, storyImages.storyId))
    .where(eq(storyImages.familyPhotoId, photo.id));
  for (const s of attachedStories) {
    if ((await decideStoryRead(db, ctx, s)).allowed) return ALLOW;
  }

  return DENY(
    "viewer holds no active membership in any family the photo is placed in, " +
      "and the photo backs no story the viewer may read",
  );
}

/**
 * The core album-read decision by id: ALLOW iff the viewer shares an ACTIVE membership in ANY family
 * the (non-deleted) photo is placed in. Reads just the id + deletedAt it needs to decide.
 */
export async function authorizeAlbumPhotoRead(
  db: Database,
  ctx: AuthContext,
  photoId: string,
): Promise<AuthDecision> {
  const [photo] = await db
    .select({ id: familyPhotos.id, deletedAt: familyPhotos.deletedAt })
    .from(familyPhotos)
    .where(eq(familyPhotos.id, photoId))
    .limit(1);
  return decideAlbumPhotoRead(db, ctx, photo);
}

/**
 * May `ctx`'s viewer MANAGE (caption/delete) this photo? The album's management authority (ADR-0009
 * caption · ADR-0008 delete) is NOT the read model: reading is membership-based, but managing is
 * contributor-or-steward. ALLOW iff the viewer is the photo's CONTRIBUTOR (erasure of their own
 * content) OR the STEWARD of any family the (non-deleted) photo is placed in (moderation — "a steward
 * may delete anything in their Family"). A plain member, a non-member, an anonymous viewer, and a
 * soft-deleted / absent photo are all DENIED. Fetches the placed-in families' steward ids in one
 * query. The contributor is authorized regardless of current membership, so they can always erase
 * their own artifact even after leaving a family.
 */
async function decideAlbumPhotoManage(
  db: Database,
  ctx: AuthContext,
  photo: Pick<FamilyPhoto, "id" | "contributorPersonId" | "deletedAt"> | undefined,
): Promise<AuthDecision> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) {
    return DENY("anonymous request cannot manage an album photo");
  }
  if (!photo || photo.deletedAt !== null) {
    return DENY("photo does not exist or has been deleted");
  }
  if (photo.contributorPersonId === viewer) return ALLOW;
  // Steward of any family the photo is placed in? One query joins placements → their families'
  // steward. `families.stewardPersonId` is BY DEFINITION the family's current steward, so no separate
  // active-membership check is needed here (unlike the contributor path above, which is authorized
  // regardless of membership so a contributor can always erase their own artifact).
  const stewards = await db
    .select({ stewardPersonId: families.stewardPersonId })
    .from(familyPhotoFamilies)
    .innerJoin(families, eq(families.id, familyPhotoFamilies.familyId))
    .where(eq(familyPhotoFamilies.photoId, photo.id));
  for (const { stewardPersonId } of stewards) {
    if (stewardPersonId === viewer) return ALLOW;
  }
  return DENY(
    "viewer is neither the contributor nor a steward of any family the photo is placed in",
  );
}

/** Fetch the minimal photo row the manage-decision needs (id + contributor + deletedAt), or undefined. */
async function loadManageablePhoto(
  db: Database,
  photoId: string,
): Promise<Pick<FamilyPhoto, "id" | "contributorPersonId" | "deletedAt"> | undefined> {
  const [photo] = await db
    .select({
      id: familyPhotos.id,
      contributorPersonId: familyPhotos.contributorPersonId,
      deletedAt: familyPhotos.deletedAt,
    })
    .from(familyPhotos)
    .where(eq(familyPhotos.id, photoId))
    .limit(1);
  return photo;
}

/**
 * Set (or clear) a photo's caption iff the viewer may manage it (contributor or a placed-in family's
 * steward). Last-write-wins, writes NO `consent_records` row — the caption is OFF every ledger
 * (ADR-0009) and doubles as alt text. A null / empty / whitespace-only caption clears it (stores
 * null); otherwise the trimmed text is stored. Returns the AuthDecision (caption written iff allowed).
 */
export async function setAlbumPhotoCaption(
  db: Database,
  ctx: AuthContext,
  photoId: string,
  caption: string | null,
): Promise<AuthDecision> {
  const photo = await loadManageablePhoto(db, photoId);
  const decision = await decideAlbumPhotoManage(db, ctx, photo);
  if (!decision.allowed) return decision;
  const normalized = caption && caption.trim() !== "" ? caption.trim() : null;
  await db
    .update(familyPhotos)
    .set({ caption: normalized })
    .where(eq(familyPhotos.id, photoId));
  return decision;
}

/**
 * Soft-delete a photo (set `deletedAt`) iff the viewer may manage it. A photo is a single shared row,
 * so an authorized delete removes it from EVERY family it was placed in and its bytes route 404s
 * thereafter (ADR-0008; bytes are left in storage — purge is a later lifecycle concern).
 * Idempotent-guarded: an already-deleted or absent photo DENYs. Returns the AuthDecision.
 */
export async function softDeleteAlbumPhoto(
  db: Database,
  ctx: AuthContext,
  photoId: string,
): Promise<AuthDecision> {
  const photo = await loadManageablePhoto(db, photoId);
  const decision = await decideAlbumPhotoManage(db, ctx, photo);
  if (!decision.allowed) return decision;
  await db
    .update(familyPhotos)
    .set({ deletedAt: new Date() })
    .where(eq(familyPhotos.id, photoId));
  return decision;
}

/**
 * The front-door byte read (mirrors `getMediaForViewer`): returns the full photo row — including its
 * `storageKey` — iff the viewer is authorized, else null. The bytes route uses this so the raw
 * `family_photos` table is never reached outside this audited file. Fetches the row ONCE and derives
 * the decision from it (via the shared `decideAlbumPhotoRead`), so there is no redundant round-trip.
 */
export async function getAlbumPhotoForViewer(
  db: Database,
  ctx: AuthContext,
  photoId: string,
): Promise<FamilyPhoto | null> {
  const [photo] = await db
    .select()
    .from(familyPhotos)
    .where(eq(familyPhotos.id, photoId))
    .limit(1);
  const decision = await decideAlbumPhotoRead(db, ctx, photo);
  return decision.allowed ? (photo ?? null) : null;
}

// ===========================================================================
// Photo tagging — subjects, people, and places (album enhancements, 2026-07-13).
//
// These mirror `story_subjects` tagging (story-repository.ts): a `photo_subjects` / `photo_people` /
// `photo_places` row is a PLAIN association behind the content wall, gated by the SAME front door as
// the photo it references. Authorization model:
//   - tag / untag / list  = SEE-gated. The actor must be able to READ the photo
//     (`authorizeAlbumPhotoRead`) AND be an identified account (`viewerPersonId !== null`). Any
//     co-viewer may tag; tagging NEVER widens who can see the photo (it is not an access grant). A
//     viewer who cannot see the photo is DENIED on tag/untag (returns the denial `AuthDecision`, does
//     NOT throw for authz — matching `setAlbumPhotoCaption`) and gets an EMPTY list on reads (no leak).
//   - retargetPhotoFamilies = MANAGE-gated (contributor or steward), mirroring `retargetStoryFamilies`.
//
// The inline-mention path is IDENTICAL to `tagStorySubject`: a named subject/person not yet a Person
// is minted as `origin='mention'`, `identified=true`, `spokenName` = first whitespace-delimited word.
// ===========================================================================

/** A tagged Person on a photo (subject OR appears-in). Mirrors `StorySubjectView`. */
export interface PhotoTagPersonView {
  personId: string;
  /** NULL only for an anonymous placeholder mention; a tagged person is normally named. */
  displayName: string | null;
  taggedByPersonId: string;
  createdAt: Date;
}

/** A place tagged on a photo. */
export interface PhotoPlaceView {
  placeId: string;
  name: string;
  familyId: string;
  taggedByPersonId: string;
  createdAt: Date;
}

export interface TagPhotoPersonInput {
  photoId: string;
  /** Tag an EXISTING Person by id. Mutually exclusive with `newPersonDisplayName`. */
  personId?: string;
  /** Create an identified `mention` Person with this name and tag it, in one operation. */
  newPersonDisplayName?: string;
}

export type TagPhotoPersonResult = AuthDecision & {
  tagged?: true;
  /** The Person now tagged (existing id, or the freshly-minted mention). */
  personId?: string;
  /** Set only when a `mention` Person was created inline (equals `personId`). */
  createdPersonId?: string;
};

/**
 * SEE-gate helper for the tag surface: the actor must be an identified account AND able to read the
 * photo. Returns `{ viewer, decision }`; when `decision.allowed` is false the caller returns it
 * unchanged (no throw, no write). Mirrors `setAlbumPhotoCaption`'s pattern of returning the decision.
 */
async function decidePhotoTag(
  db: Database,
  ctx: AuthContext,
  photoId: string,
): Promise<{ viewer: string | null; decision: AuthDecision }> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) {
    return { viewer, decision: DENY("anonymous request cannot tag an album photo") };
  }
  const decision = await authorizeAlbumPhotoRead(db, ctx, photoId);
  return { viewer, decision };
}

/**
 * Mint an identified `mention` Person (mirrors `tagStorySubject` / kinship-write `insertMentionPerson`).
 * Runs inside a caller transaction handle.
 */
async function insertMentionPersonTx(
  tx: Pick<Database, "insert">,
  newPersonDisplayName: string,
): Promise<string> {
  const displayName = newPersonDisplayName.trim();
  if (displayName.length === 0) {
    throw new InvariantViolation("newPersonDisplayName must be non-empty");
  }
  const spokenName = displayName.split(/\s+/)[0] ?? null;
  const [row] = await tx
    .insert(persons)
    .values({ displayName, spokenName, origin: "mention", identified: true, accountId: null })
    .returning({ id: persons.id });
  return row!.id;
}

/**
 * Shared tag-a-person implementation for both `photo_subjects` and `photo_people` (identical shape).
 * `table` is the link table to write. SEE-gated; either tag `personId` or mint a `mention` from
 * `newPersonDisplayName` (exactly one). Idempotent per (photoId, personId) via the unique index — a
 * duplicate is a success with no new row and no mint (the mint runs only when `newPersonDisplayName`
 * is given). If SEE-denied, returns the denial with no insert and no person minted.
 */
async function tagPhotoPersonInto(
  db: Database,
  ctx: AuthContext,
  table: typeof photoSubjects | typeof photoPeople,
  input: TagPhotoPersonInput,
): Promise<TagPhotoPersonResult> {
  const hasExisting = input.personId !== undefined;
  const hasNew = input.newPersonDisplayName !== undefined;
  if (hasExisting === hasNew) {
    throw new InvariantViolation(
      "tagPhoto*: provide exactly one of personId or newPersonDisplayName",
    );
  }
  const { viewer, decision } = await decidePhotoTag(db, ctx, input.photoId);
  if (!decision.allowed || viewer === null) return decision;

  return db.transaction(async (tx) => {
    let personId: string;
    let createdPersonId: string | undefined;
    if (hasNew) {
      personId = await insertMentionPersonTx(tx, input.newPersonDisplayName!);
      createdPersonId = personId;
    } else {
      personId = input.personId!;
    }
    await tx
      .insert(table)
      .values({ photoId: input.photoId, personId, taggedByPersonId: viewer })
      .onConflictDoNothing({ target: [table.photoId, table.personId] });
    const result: TagPhotoPersonResult = { ...ALLOW, tagged: true, personId };
    if (createdPersonId !== undefined) result.createdPersonId = createdPersonId;
    return result;
  });
}

/** SEE-gated delete from a person link table (idempotent). */
async function untagPhotoPersonFrom(
  db: Database,
  ctx: AuthContext,
  table: typeof photoSubjects | typeof photoPeople,
  input: { photoId: string; personId: string },
): Promise<AuthDecision> {
  const { decision } = await decidePhotoTag(db, ctx, input.photoId);
  if (!decision.allowed) return decision;
  await db
    .delete(table)
    .where(and(eq(table.photoId, input.photoId), eq(table.personId, input.personId)));
  return decision;
}

/** SEE-gated read of a person link table; empty when the viewer cannot see the photo. */
async function listPhotoPeopleFrom(
  db: Database,
  ctx: AuthContext,
  table: typeof photoSubjects | typeof photoPeople,
  photoId: string,
): Promise<PhotoTagPersonView[]> {
  const decision = await authorizeAlbumPhotoRead(db, ctx, photoId);
  if (!decision.allowed) return [];
  const rows = await db
    .select({
      personId: table.personId,
      displayName: persons.displayName,
      taggedByPersonId: table.taggedByPersonId,
      createdAt: table.createdAt,
    })
    .from(table)
    .innerJoin(persons, eq(persons.id, table.personId))
    .where(eq(table.photoId, photoId))
    .orderBy(asc(table.createdAt));
  return rows.map((r) => ({
    personId: r.personId,
    displayName: r.displayName,
    taggedByPersonId: r.taggedByPersonId,
    createdAt: r.createdAt,
  }));
}

/** Tag a Person as a SUBJECT of a photo (who it is ABOUT). SEE-gated. */
export function tagPhotoSubject(
  db: Database,
  ctx: AuthContext,
  input: TagPhotoPersonInput,
): Promise<TagPhotoPersonResult> {
  return tagPhotoPersonInto(db, ctx, photoSubjects, input);
}

/** Untag a subject Person from a photo. SEE-gated, idempotent. */
export function untagPhotoSubject(
  db: Database,
  ctx: AuthContext,
  input: { photoId: string; personId: string },
): Promise<AuthDecision> {
  return untagPhotoPersonFrom(db, ctx, photoSubjects, input);
}

/** The Persons a photo is ABOUT. SEE-gated; empty if the viewer cannot see the photo. */
export function listPhotoSubjects(
  db: Database,
  ctx: AuthContext,
  photoId: string,
): Promise<PhotoTagPersonView[]> {
  return listPhotoPeopleFrom(db, ctx, photoSubjects, photoId);
}

/** Tag a Person as APPEARING in a photo (distinct from subjects). SEE-gated. */
export function tagPhotoPerson(
  db: Database,
  ctx: AuthContext,
  input: TagPhotoPersonInput,
): Promise<TagPhotoPersonResult> {
  return tagPhotoPersonInto(db, ctx, photoPeople, input);
}

/** Untag an appears-in Person from a photo. SEE-gated, idempotent. */
export function untagPhotoPerson(
  db: Database,
  ctx: AuthContext,
  input: { photoId: string; personId: string },
): Promise<AuthDecision> {
  return untagPhotoPersonFrom(db, ctx, photoPeople, input);
}

/** The Persons who APPEAR in a photo. SEE-gated; empty if the viewer cannot see the photo. */
export function listPhotoPeople(
  db: Database,
  ctx: AuthContext,
  photoId: string,
): Promise<PhotoTagPersonView[]> {
  return listPhotoPeopleFrom(db, ctx, photoPeople, photoId);
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export interface TagPhotoPlaceInput {
  photoId: string;
  /** Link an EXISTING place by id. Mutually exclusive with `newPlaceName`. */
  placeId?: string;
  /** Create-or-reuse a place with this name in the resolved target family. */
  newPlaceName?: string;
  /**
   * The target family for a NEW place. Honored only when the photo is placed in it AND the viewer is
   * an active member of it. When omitted, the family is resolved from the photo's placements (must be
   * unambiguous — exactly one). Ignored for the `placeId` path.
   */
  familyId?: string;
}

export type TagPhotoPlaceResult = AuthDecision & {
  tagged?: true;
  placeId?: string;
  /** Set only when a new `places` row was created. */
  createdPlaceId?: string;
};

/** Case-insensitive name reuse within a family; else insert a new `places` row seeded from EXIF GPS. */
async function resolveOrCreatePlaceTx(
  tx: Database,
  familyId: string,
  name: string,
  createdByPersonId: string,
  exifGps: { lat: number; lng: number } | null,
): Promise<{ placeId: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: places.id })
    .from(places)
    .where(and(eq(places.familyId, familyId), sql`lower(${places.name}) = lower(${name})`))
    .limit(1);
  if (existing) return { placeId: existing.id, created: false };
  const [row] = await tx
    .insert(places)
    .values({ familyId, name, createdByPersonId, exifGps: exifGps ?? null })
    .returning({ id: places.id });
  return { placeId: row!.id, created: true };
}

/**
 * Tag a photo with a place. SEE-gated. Two modes:
 *   - `placeId`: link an existing place, VALIDATING its family is one the photo is placed in.
 *   - `newPlaceName`: resolve the target family, then create-or-reuse the place (case-insensitive
 *     dedup within that family, seeded from the photo's `exif_gps`), then link it.
 * The `photo_places` insert is idempotent per (photoId, placeId).
 *
 * New-place family resolution: use `familyId` when given AND the photo is placed in it AND the viewer
 * is an active member of it; otherwise, if the photo is in exactly ONE family, use that; otherwise
 * DENY as ambiguous (the caller must pass `familyId`).
 */
export async function tagPhotoPlace(
  db: Database,
  ctx: AuthContext,
  input: TagPhotoPlaceInput,
): Promise<TagPhotoPlaceResult> {
  const hasExisting = input.placeId !== undefined;
  const hasNew = input.newPlaceName !== undefined;
  if (hasExisting === hasNew) {
    throw new InvariantViolation(
      "tagPhotoPlace: provide exactly one of placeId or newPlaceName",
    );
  }
  const { viewer, decision } = await decidePhotoTag(db, ctx, input.photoId);
  if (!decision.allowed || viewer === null) return decision;

  // The families this (non-deleted, viewer-visible) photo is placed in.
  const placementRows = await db
    .select({ familyId: familyPhotoFamilies.familyId })
    .from(familyPhotoFamilies)
    .where(eq(familyPhotoFamilies.photoId, input.photoId));
  const placementFamilies = new Set(placementRows.map((r) => r.familyId));

  return db.transaction(async (tx) => {
    let placeId: string;
    let createdPlaceId: string | undefined;

    if (hasExisting) {
      const [place] = await tx
        .select({ familyId: places.familyId })
        .from(places)
        .where(eq(places.id, input.placeId!))
        .limit(1);
      if (!place) {
        throw new InvariantViolation(`tagPhotoPlace: place ${input.placeId} not found`);
      }
      if (!placementFamilies.has(place.familyId)) {
        throw new InvariantViolation(
          `tagPhotoPlace: place ${input.placeId} belongs to a family the photo is not placed in`,
        );
      }
      placeId = input.placeId!;
    } else {
      const name = input.newPlaceName!.trim();
      if (name.length === 0) {
        throw new InvariantViolation("tagPhotoPlace: newPlaceName must be non-empty");
      }
      // Resolve the target family.
      const viewerFamilies = await activeFamilyIds(tx as Database, viewer);
      let targetFamily: string | undefined;
      if (input.familyId !== undefined) {
        if (placementFamilies.has(input.familyId) && viewerFamilies.has(input.familyId)) {
          targetFamily = input.familyId;
        } else {
          throw new InvariantViolation(
            `tagPhotoPlace: familyId ${input.familyId} is not a family the photo is placed in ` +
              `and the viewer is an active member of`,
          );
        }
      } else if (placementFamilies.size === 1) {
        targetFamily = [...placementFamilies][0]!;
      } else {
        throw new InvariantViolation(
          "tagPhotoPlace: ambiguous family for new place — the photo is placed in multiple " +
            "families; pass familyId",
        );
      }
      // Seed exifGps from the photo when present.
      const [photoRow] = await tx
        .select({ exifGps: familyPhotos.exifGps })
        .from(familyPhotos)
        .where(eq(familyPhotos.id, input.photoId))
        .limit(1);
      const resolved = await resolveOrCreatePlaceTx(
        tx as Database,
        targetFamily,
        name,
        viewer,
        photoRow?.exifGps ?? null,
      );
      placeId = resolved.placeId;
      if (resolved.created) createdPlaceId = resolved.placeId;
    }

    await tx
      .insert(photoPlaces)
      .values({ photoId: input.photoId, placeId, taggedByPersonId: viewer })
      .onConflictDoNothing({ target: [photoPlaces.photoId, photoPlaces.placeId] });

    const result: TagPhotoPlaceResult = { ...ALLOW, tagged: true, placeId };
    if (createdPlaceId !== undefined) result.createdPlaceId = createdPlaceId;
    return result;
  });
}

/** Untag a place from a photo. SEE-gated, idempotent. */
export async function untagPhotoPlace(
  db: Database,
  ctx: AuthContext,
  input: { photoId: string; placeId: string },
): Promise<AuthDecision> {
  const { decision } = await decidePhotoTag(db, ctx, input.photoId);
  if (!decision.allowed) return decision;
  await db
    .delete(photoPlaces)
    .where(
      and(eq(photoPlaces.photoId, input.photoId), eq(photoPlaces.placeId, input.placeId)),
    );
  return decision;
}

/** The places a photo is tagged with. SEE-gated; empty if the viewer cannot see the photo. */
export async function listPhotoPlaces(
  db: Database,
  ctx: AuthContext,
  photoId: string,
): Promise<PhotoPlaceView[]> {
  const decision = await authorizeAlbumPhotoRead(db, ctx, photoId);
  if (!decision.allowed) return [];
  const rows = await db
    .select({
      placeId: places.id,
      name: places.name,
      familyId: places.familyId,
      taggedByPersonId: photoPlaces.taggedByPersonId,
      createdAt: photoPlaces.createdAt,
    })
    .from(photoPlaces)
    .innerJoin(places, eq(places.id, photoPlaces.placeId))
    .where(eq(photoPlaces.photoId, photoId))
    .orderBy(asc(photoPlaces.createdAt));
  return rows;
}

/**
 * The places in a family, for place suggestions/typeahead. The viewer must be an active member of
 * `familyId`; a non-member (or anonymous) gets an empty list (no leak of a family's place names).
 */
export async function listPlacesForFamily(
  db: Database,
  ctx: AuthContext,
  familyId: string,
): Promise<{ placeId: string; name: string }[]> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) return [];
  const viewerFamilies = await activeFamilyIds(db, viewer);
  if (!viewerFamilies.has(familyId)) return [];
  const rows = await db
    .select({ placeId: places.id, name: places.name })
    .from(places)
    .where(eq(places.familyId, familyId))
    .orderBy(asc(places.name));
  return rows;
}

// ---------------------------------------------------------------------------
// retargetPhotoFamilies — MANAGE-gated re-placement of a photo's album set.
// ---------------------------------------------------------------------------

/**
 * Replace the set of families a photo is placed in. MANAGE-gated (contributor or steward), mirroring
 * `retargetStoryFamilies`. Validates: every id in `familyIds` is a family the VIEWER is an active
 * member of (a photo is never placed into a family the actor isn't in), de-dupes, and requires >=1.
 * The `family_photo_families` set is replaced (delete old, insert new) in one transaction. On authz
 * denial the decision is returned unchanged (no write).
 */
export async function retargetPhotoFamilies(
  db: Database,
  ctx: AuthContext,
  input: { photoId: string; familyIds: string[] },
): Promise<AuthDecision> {
  const viewer = viewerPersonId(ctx);
  const photo = await loadManageablePhoto(db, input.photoId);
  const decision = await decideAlbumPhotoManage(db, ctx, photo);
  if (!decision.allowed || viewer === null) return decision;

  const familyIds = [...new Set(input.familyIds)];
  if (familyIds.length === 0) {
    throw new InvariantViolation(
      "retargetPhotoFamilies: a photo must be placed in at least one family album",
    );
  }
  const viewerFamilies = await activeFamilyIds(db, viewer);
  for (const familyId of familyIds) {
    if (!viewerFamilies.has(familyId)) {
      throw new InvariantViolation(
        `retargetPhotoFamilies: viewer is not an active member of family ${familyId}`,
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(familyPhotoFamilies)
      .where(eq(familyPhotoFamilies.photoId, input.photoId));
    await tx
      .insert(familyPhotoFamilies)
      .values(familyIds.map((familyId) => ({ photoId: input.photoId, familyId })));
  });
  return decision;
}

// ---------------------------------------------------------------------------
// getAlbumPhotoDetail — the SEE-gated single-photo read for the tag-management UI.
// ---------------------------------------------------------------------------

export interface AlbumPhotoDetailView extends AlbumPhotoView {
  contributorDisplayName: string | null;
  /** The families the photo is placed in (its album placements). */
  families: { familyId: string; familyName: string; familyShortName: string | null }[];
  subjects: PhotoTagPersonView[];
  people: PhotoTagPersonView[];
  places: PhotoPlaceView[];
  /** Whether the viewer may MANAGE the photo (contributor or steward). */
  canManage: boolean;
}

/**
 * A single photo plus everything the tag-management UI needs: its base fields, contributor name, its
 * album placements, its tag groups, and the viewer's manage capability. SEE-gated — returns null if
 * the viewer cannot see the photo (no leak). Tag groups are read via the same SEE-gated helpers, so
 * they are always consistent with the top-level SEE decision.
 */
export async function getAlbumPhotoDetail(
  db: Database,
  ctx: AuthContext,
  photoId: string,
): Promise<AlbumPhotoDetailView | null> {
  const [photo] = await db
    .select()
    .from(familyPhotos)
    .where(eq(familyPhotos.id, photoId))
    .limit(1);
  const seeDecision = await decideAlbumPhotoRead(db, ctx, photo);
  if (!seeDecision.allowed || !photo) return null;

  const [contributor] = await db
    .select({ displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, photo.contributorPersonId))
    .limit(1);

  const familyRows = await db
    .select({ familyId: families.id, familyName: families.name, familyShortName: families.shortName })
    .from(familyPhotoFamilies)
    .innerJoin(families, eq(families.id, familyPhotoFamilies.familyId))
    .where(eq(familyPhotoFamilies.photoId, photoId))
    .orderBy(asc(families.name));

  const [subjects, people, placeTags, manageDecision] = await Promise.all([
    listPhotoSubjects(db, ctx, photoId),
    listPhotoPeople(db, ctx, photoId),
    listPhotoPlaces(db, ctx, photoId),
    decideAlbumPhotoManage(db, ctx, photo),
  ]);

  return {
    id: photo.id,
    contributorPersonId: photo.contributorPersonId,
    source: photo.source,
    storageKey: photo.storageKey,
    caption: photo.caption,
    exifCapturedAt: photo.exifCapturedAt,
    createdAt: photo.createdAt,
    contributorDisplayName: contributor?.displayName ?? null,
    families: familyRows,
    subjects,
    people,
    places: placeTags,
    canManage: manageDecision.allowed,
  };
}
