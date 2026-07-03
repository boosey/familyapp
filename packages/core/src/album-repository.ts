/**
 * The album write + read front door (ADR-0009 · #15). This is the ONLY production file permitted to
 * touch the guarded `family_photos` / `family_photo_families` tables — keeping every album content
 * read AND write in a tiny, auditable surface, exactly as authorization.ts / story-repository.ts do
 * for stories/media. It is on the architecture-test allowlist for precisely that reason.
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
import { and, desc, eq, isNull } from "drizzle-orm";
import { familyPhotoFamilies, familyPhotos } from "@chronicle/db/content";
import { families, memberships } from "@chronicle/db/schema";
import type { Database, FamilyPhoto, PhotoSource } from "@chronicle/db";
import {
  type AuthContext,
  type AuthDecision,
  viewerPersonId,
} from "./authorization";
import { InvariantViolation } from "./errors";

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

/**
 * The photos in `familyId`'s album, most-recent first, EXCLUDING soft-deleted rows. The viewer must
 * hold an ACTIVE membership in `familyId`; a non-member (or anonymous) viewer gets an empty list
 * (an album never leaks to someone who isn't in the family).
 */
export async function listAlbumPhotos(
  db: Database,
  ctx: AuthContext,
  familyId: string,
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
    .orderBy(desc(familyPhotos.createdAt), desc(familyPhotos.id));
}

/**
 * The single album-read decision, given an already-fetched photo (or its absence). ALLOW iff the
 * viewer shares an ACTIVE membership in ANY family the (non-deleted) photo is placed in. A
 * soft-deleted or non-existent photo is DENIED (treated as absent), as is any anonymous request.
 * No owner/contributor bypass — the contributor is authorized only by virtue of still being an
 * active member of a family the photo is in (the album model has no private-to-the-contributor
 * state; placing a photo IS sharing it with those families). Both public entry points funnel
 * through this, so there is exactly ONE decision implementation.
 */
async function decideAlbumPhotoRead(
  db: Database,
  ctx: AuthContext,
  photo: Pick<FamilyPhoto, "id" | "deletedAt"> | undefined,
): Promise<AuthDecision> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) {
    return DENY("anonymous request cannot read an album photo");
  }
  if (!photo || photo.deletedAt !== null) {
    return DENY("photo does not exist or has been deleted");
  }
  const placements = await db
    .select({ familyId: familyPhotoFamilies.familyId })
    .from(familyPhotoFamilies)
    .where(eq(familyPhotoFamilies.photoId, photo.id));
  if (placements.length === 0) {
    return DENY("photo is in no family album");
  }
  const viewerFamilies = await activeFamilyIds(db, viewer);
  for (const { familyId } of placements) {
    if (viewerFamilies.has(familyId)) return ALLOW;
  }
  return DENY(
    "viewer holds no active membership in any family the photo is placed in",
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
