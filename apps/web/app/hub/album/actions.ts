"use server";

/**
 * Album upload server action (ADR-0009 · #15). Like every hub action, it re-resolves auth on the
 * server — the contributor's identity is NEVER trusted from the client; only the file bytes come in
 * via FormData. The bytes are written to object storage FIRST (write-once `family-photos/<uuid>`
 * key), then `createAlbumPhoto` records the row + album membership. Photos are NOT `media` — no
 * media row, not under the immutability trigger (ADR-0009).
 *
 * #16: the target album set is the contributor's PICKER choice, re-validated on the server against
 * their OWN active memberships — a client-submitted family id is never trusted, so any family they
 * are not an active member of is dropped (they are always an active member of every album they place
 * into). A solo-family contributor sees no picker; the sole family is used. #17 populates EXIF
 * (capture-date + GPS) at import — read from the SAME bytes below, never failing the upload.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  createAlbumPhoto,
  getAlbumPhotoDetail,
  listActiveFamiliesForPerson,
  listMyKin,
  listPlacesForFamily,
  retargetPhotoFamilies,
  setAlbumPhotoCaption,
  softDeleteAlbumPhoto,
  tagPhotoPerson,
  tagPhotoPlace,
  tagPhotoSubject,
  untagPhotoPerson,
  untagPhotoPlace,
  untagPhotoSubject,
  viewerPersonId,
  type AlbumPhotoDetailView,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { PHOTO_BATCH_MAX_FILES } from "@/lib/constants";
import { extractPhotoExif, type PhotoExif } from "@/app/hub/album/exif";
import { hub } from "@/app/_copy";
import type { ImportOnePhotoResult } from "./import-progress";

/**
 * Batch upload summary. A single submit can carry MANY files (the multi-select picker, #16): each
 * selected file becomes its own album photo placed into the SAME chosen album(s). `added`/`failed`
 * count the per-file outcomes so the client can distinguish a full success from a partial one.
 *   - 0 valid files          → `{ error: photoEmpty }`
 *   - every file threw       → `{ error: photoUploadFailed }` (added === 0, failed > 0)
 *   - otherwise              → `{ ok: true, added, failed }` (failed may be 0)
 */
export type AlbumUploadResult =
  | { ok: true; added: number; failed: number }
  | { error: string };

/** Result of a caption edit / delete: success, or a user-facing error string. */
export type AlbumManageResult = { ok: true } | { error: string };

/** The longest caption we accept (it doubles as alt text — a label, not prose). */
const MAX_CAPTION_LENGTH = 500;

/**
 * The most photos one batch may carry. A server-authoritative cap (the client guards too, but the
 * client is never trusted): it bounds per-request work/memory and rejects an abusive "thousands of
 * tiny files" submission before we touch storage. Single source of truth: PHOTO_BATCH_MAX_FILES.
 */
const MAX_BATCH_FILES = PHOTO_BATCH_MAX_FILES;

/** Safe, short error token for the UI — never include secrets or full stack traces. */
function sanitizeStorageErrorDetail(err: unknown): string {
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: unknown }).name ?? "")
      : "";
  const message = err instanceof Error ? err.message : String(err);
  const raw = (name && name !== "Error" ? name : message.split(/[:\n]/)[0]) ?? "error";
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "").slice(0, 48);
  return safe || "error";
}

export async function uploadAlbumPhotoAction(
  formData: FormData,
): Promise<AlbumUploadResult> {
  // [DIAG] Temporary tracing for the album-upload "Not signed in" investigation. runtimeMs exposes a
  // cold start (the "long delay"); ctx.kind reveals whether auth degraded to anonymous. Remove once
  // understood. Pairs with the [DIAG auth-clerk] line that names WHICH anonymous branch fired.
  const tStart = Date.now();
  const { db, storage, auth } = await getRuntime();
  const tRuntime = Date.now();
  const ctx = await auth.getCurrentAuthContext();
  console.info(
    `[DIAG album/upload] ctx.kind=${ctx.kind} runtimeMs=${tRuntime - tStart} authMs=${Date.now() - tRuntime}`,
  );
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  // Resolve the target album set from the client's picker choice, re-validated against the
  // contributor's OWN active memberships — client-submitted ids are NEVER trusted.
  const active = await listActiveFamiliesForPerson(db, ctx.personId);
  if (active.length === 0) return { error: hub.actions.noFamily };
  const allowed = new Set(active.map((f) => f.familyId));
  const submitted = formData
    .getAll("familyIds")
    .filter((v): v is string => typeof v === "string");
  const chosen = [...new Set(submitted.filter((id) => allowed.has(id)))];
  let familyIds: string[];
  if (chosen.length > 0) {
    familyIds = chosen;
  } else if (allowed.size === 1) {
    familyIds = [active[0]!.familyId]; // solo contributor: no picker rendered → sole family
  } else {
    return { error: hub.actions.noAlbumChosen }; // multi-family with no valid selection
  }

  // Multi-select (#16): a `multiple` file input yields repeated `photo` entries, so read ALL of
  // them. Keep only real, non-empty Blobs — a browser may append an empty phantom entry, and a
  // stray non-file field must never be treated as an image.
  const files = formData
    .getAll("photo")
    .filter((v): v is File => v instanceof Blob && v.size > 0);
  if (files.length === 0) {
    return { error: hub.actions.photoEmpty };
  }
  // Server-authoritative batch cap (the client guards too, but is never trusted).
  if (files.length > MAX_BATCH_FILES) {
    return { error: hub.actions.tooManyPhotos };
  }

  // Each file is uploaded INDEPENDENTLY into the same chosen album(s). A per-file storage/db throw
  // increments `failed` and moves on — one bad file never aborts the batch (so a 10-photo upload
  // with one corrupt file still lands the other nine).
  let added = 0;
  let failed = 0;
  let lastFailureDetail: string | null = null;
  for (const photo of files) {
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const contentType = photo.type || "application/octet-stream";
    const storageKey = `family-photos/${randomUUID()}`;

    // #17: read capture-date + GPS from the SAME bytes (no second round-trip). The helper never
    // throws, but keep the extraction OUTSIDE the storage/db try and belt-and-suspenders it anyway,
    // so even a hypothetical future throw yields null EXIF + a successful upload for this file —
    // never a failed upload on EXIF alone.
    let exif: PhotoExif = { capturedAt: null, gps: null };
    try {
      exif = await extractPhotoExif(bytes);
    } catch {
      /* never fail the upload on EXIF */
    }

    try {
      await storage.put({ key: storageKey, bytes, contentType });
      await createAlbumPhoto(db, {
        contributorPersonId: ctx.personId,
        familyIds,
        source: "upload",
        storageKey,
        caption: null,
        exifCapturedAt: exif.capturedAt,
        exifGps: exif.gps,
      });
      added += 1;
    } catch (err) {
      failed += 1;
      lastFailureDetail = sanitizeStorageErrorDetail(err);
      if (failed === 1) {
        console.error(
          `[album/upload] storage/create failed for ${storageKey} (${contentType}, ${bytes.byteLength} bytes):`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // Revalidate once for the whole batch, only if at least one photo actually landed.
  // Album is mounted at BOTH /hub?tab=album and /hub/album — refresh both.
  if (added > 0) {
    revalidatePath("/hub");
    revalidatePath("/hub/album");
  }
  // The whole batch failed (nothing valid landed) → a single upload error, mirroring the single-file
  // behavior. Otherwise it's a success, with `failed` telling the client whether to nudge about the
  // ones that didn't make it.
  if (added === 0) {
    if (lastFailureDetail) {
      return { error: hub.actions.photoUploadFailedDetail(lastFailureDetail) };
    }
    return { error: hub.actions.photoUploadFailed };
  }
  return { ok: true, added, failed };
}

/**
 * Per-item sibling of `uploadAlbumPhotoAction` (ADR-0015 · F2). The client drives import as ONE call
 * per photo through a bounded concurrency pool so each placeholder tile resolves — or fails with a
 * tap-to-retry — independently. Mirrors the batch action's guards EXACTLY but for a single file:
 * re-resolves auth server-side (identity is NEVER trusted from the client), re-validates the target
 * family set against the contributor's OWN active memberships, then EXIF + storage.put + createAlbumPhoto.
 * The 30-item cap moves to the client (a UX/resource guard, not a security boundary — ADR-0015).
 */
export async function uploadOneAlbumPhotoAction(
  formData: FormData,
): Promise<ImportOnePhotoResult> {
  // [DIAG] Same tracing as the batch action — this per-item path MULTIPLIES the Clerk auth() surface
  // (N calls instead of 1), so the "Not signed in" investigation needs it here too. Remove once solved.
  const tStart = Date.now();
  const { db, storage, auth } = await getRuntime();
  const tRuntime = Date.now();
  const ctx = await auth.getCurrentAuthContext();
  console.info(
    `[DIAG album/upload] ctx.kind=${ctx.kind} runtimeMs=${tRuntime - tStart} authMs=${Date.now() - tRuntime}`,
  );
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  // Re-validate the target album set against the contributor's OWN active memberships — identical
  // rules to the batch action; client-submitted ids are NEVER trusted.
  const active = await listActiveFamiliesForPerson(db, ctx.personId);
  if (active.length === 0) return { error: hub.actions.noFamily };
  const allowed = new Set(active.map((f) => f.familyId));
  const submitted = formData
    .getAll("familyIds")
    .filter((v): v is string => typeof v === "string");
  const chosen = [...new Set(submitted.filter((id) => allowed.has(id)))];
  let familyIds: string[];
  if (chosen.length > 0) {
    familyIds = chosen;
  } else if (allowed.size === 1) {
    familyIds = [active[0]!.familyId];
  } else {
    return { error: hub.actions.noAlbumChosen };
  }

  // Exactly one file: the first real, non-empty Blob among the `photo` entries.
  const photo = formData
    .getAll("photo")
    .find((v): v is File => v instanceof Blob && v.size > 0);
  if (!photo) return { error: hub.actions.photoEmpty };

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const contentType = photo.type || "application/octet-stream";
  const storageKey = `family-photos/${randomUUID()}`;

  // #17: read EXIF from the SAME bytes; never fail the upload on EXIF alone.
  let exif: PhotoExif = { capturedAt: null, gps: null };
  try {
    exif = await extractPhotoExif(bytes);
  } catch {
    /* never fail the upload on EXIF */
  }

  let photoId: string;
  try {
    await storage.put({ key: storageKey, bytes, contentType });
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: ctx.personId,
      familyIds,
      source: "upload",
      storageKey,
      caption: null,
      exifCapturedAt: exif.capturedAt,
      exifGps: exif.gps,
    });
    photoId = photo.id;
  } catch (err) {
    console.error(
      `[album/upload] storage/create failed for ${storageKey} (${contentType}, ${bytes.byteLength} bytes):`,
      err instanceof Error ? err.message : String(err),
    );
    return { error: hub.actions.photoUploadFailedDetail(sanitizeStorageErrorDetail(err)) };
  }

  revalidatePath("/hub");
  revalidatePath("/hub/album");
  // Return the new id so the board renders this tile's real bytes optimistically (ADR-0015): the
  // placeholder swaps straight to the photo instead of blanking until the server refresh lands.
  return { ok: true, photoId };
}

/**
 * Edit (or clear) a photo's caption. Like every hub action it re-resolves auth on the server and
 * forwards the AuthContext to the audited seam, which re-checks the contributor/steward rule — the
 * client is NEVER trusted for identity. A caption longer than the label cap is rejected up front; a
 * seam DENY (not the contributor and not a steward) surfaces a single non-committal error.
 */
export async function editAlbumCaptionAction(
  formData: FormData,
): Promise<AlbumManageResult> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const photoId = formData.get("photoId");
  if (typeof photoId !== "string" || photoId === "") {
    return { error: hub.actions.invalidInput };
  }
  const raw = formData.get("caption");
  // A missing field or a non-string clears the caption; the seam normalizes empty/whitespace → null.
  const caption = typeof raw === "string" ? raw : null;
  // Server-authoritative length, measured on the NORMALIZED (trimmed) caption to match the seam —
  // leading/trailing whitespace must not spuriously reject a caption that stores as ≤500 chars.
  if (caption !== null && caption.trim().length > MAX_CAPTION_LENGTH) {
    return { error: hub.actions.captionTooLong };
  }

  try {
    const decision = await setAlbumPhotoCaption(db, ctx, photoId, caption);
    if (!decision.allowed) return { error: hub.actions.notAllowedToManagePhoto };
    revalidatePath("/hub/album");
    return { ok: true };
  } catch {
    // An unexpected DB/seam throw becomes a friendly inline error instead of an unhandled
    // rejection in the client transition (mirrors uploadAlbumPhotoAction's photoUploadFailed guard).
    return { error: hub.album.captionSaveError };
  }
}

/**
 * Soft-delete a photo. Re-resolves auth and forwards the AuthContext to the audited seam, which
 * re-checks the contributor/steward rule. A single shared row → an authorized delete removes it from
 * every album it was in; the bytes route 404s thereafter. A DENY surfaces a non-committal error.
 */
export async function deleteAlbumPhotoAction(
  formData: FormData,
): Promise<AlbumManageResult> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const photoId = formData.get("photoId");
  if (typeof photoId !== "string" || photoId === "") {
    return { error: hub.actions.invalidInput };
  }

  try {
    const decision = await softDeleteAlbumPhoto(db, ctx, photoId);
    if (!decision.allowed) return { error: hub.actions.notAllowedToManagePhoto };
    revalidatePath("/hub/album");
    return { ok: true };
  } catch {
    // Unexpected throw → friendly inline error, not an unhandled rejection in the transition.
    return { error: hub.album.photoDeleteError };
  }
}

/** Result of a bulk soft-delete: per-item outcome counts, or a whole-request error. */
export type AlbumBulkDeleteResult =
  | { deleted: number; failed: number }
  | { error: string };

/**
 * Bulk soft-delete photos (Phase C). Reads repeated `photoIds` entries and calls the SAME audited
 * `softDeleteAlbumPhoto` seam per id — so each item is independently MANAGE-gated (contributor or
 * steward). Re-resolves auth server-side; a non-account caller or an empty id set is the ONLY
 * whole-request error. Otherwise this is PARTIAL-SUCCESS: an item the viewer may delete increments
 * `deleted`, and an item denied by authz OR that threw increments `failed` — never aborting the batch.
 * (A plain member's targets therefore come back as `failed`, not an error.) One revalidate at the end
 * iff anything was actually deleted.
 */
export async function bulkSoftDeleteAlbumPhotosAction(
  formData: FormData,
): Promise<AlbumBulkDeleteResult> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const photoIds = [
    ...new Set(
      formData
        .getAll("photoIds")
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ];
  if (photoIds.length === 0) return { error: hub.album.noPhotosSelected };

  let deleted = 0;
  let failed = 0;
  for (const photoId of photoIds) {
    try {
      const decision = await softDeleteAlbumPhoto(db, ctx, photoId);
      if (decision.allowed) {
        deleted += 1;
      } else {
        // A per-item authz denial (not the contributor / not a steward) is a partial failure, NOT a
        // whole-request error.
        failed += 1;
      }
    } catch {
      // A DB/seam throw for one id must never abort the batch — count it and move on.
      failed += 1;
    }
  }

  if (deleted > 0) {
    revalidatePath("/hub");
    revalidatePath("/hub/album");
  }
  return { deleted, failed };
}

// ---------------------------------------------------------------------------
// Phase B2 — photo tag management (mirrors the STORY tag actions exactly).
//
// Each action re-resolves auth server-side (identity is NEVER trusted from the client) and forwards
// to the audited core seam, which is the authoritative gate. The action never re-implements
// authorization; it only maps the result to a client shape:
//   - the core seam returns an AuthDecision — a DENY (`allowed === false`) becomes a friendly
//     `{ error }` (a non-account caller short-circuits to the not-signed-in error first).
//   - a THROWN InvariantViolation (ambiguous place, unknown/foreign place id, empty name, no target
//     family) is caught and becomes a friendly `{ error }` — a stack is never leaked to the client.
// The person/subject actions forward the minted id so the client can remove a just-minted person,
// exactly like `tagStorySubjectAction`.
// ---------------------------------------------------------------------------

/** Success shape of a person/subject tag: the tagged (or freshly minted) person id. */
export type PhotoTagPersonActionResult = { personId: string } | { error: string };
/** Success shape of a place tag: the tagged (or freshly created) place id. */
export type PhotoTagPlaceActionResult = { placeId: string } | { error: string };

/**
 * Shared body for the two person-group tag actions (subjects + appears-in people). `tag` is the core
 * seam to call — `tagPhotoSubject` or `tagPhotoPerson`. Accepts EITHER an existing `personId` OR a
 * `newPersonDisplayName` (exactly one, mirroring `tagStorySubjectAction`). Returns the minted id.
 */
async function tagPhotoPersonGroup(
  formData: FormData,
  tag: typeof tagPhotoSubject,
): Promise<PhotoTagPersonActionResult> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (viewerPersonId(ctx) === null) return { error: hub.actions.notSignedIn };

  const photoId = formData.get("photoId");
  const personId = formData.get("personId");
  const newPersonDisplayName = formData.get("newPersonDisplayName");
  if (typeof photoId !== "string" || !photoId) {
    return { error: hub.actions.invalidInput };
  }
  const hasExisting = typeof personId === "string" && personId.length > 0;
  const hasNew =
    typeof newPersonDisplayName === "string" && newPersonDisplayName.trim().length > 0;
  if (hasExisting === hasNew) return { error: hub.actions.invalidInput };

  try {
    const result = await tag(db, ctx, {
      photoId,
      ...(hasExisting ? { personId: personId as string } : {}),
      ...(hasNew ? { newPersonDisplayName: (newPersonDisplayName as string).trim() } : {}),
    });
    // DENY (SEE-gate) → a non-committal error; nothing was written or minted.
    if (!result.allowed || result.personId === undefined) {
      return { error: hub.album.tagSaveError };
    }
    revalidatePath("/hub/album");
    return { personId: result.personId };
  } catch {
    // Thrown InvariantViolation (e.g. both/neither of personId/newName) → friendly error, no stack.
    return { error: hub.album.tagSaveError };
  }
}

/** Shared body for the two person-group untag actions (idempotent, SEE-gated in core). */
async function untagPhotoPersonGroup(
  formData: FormData,
  untag: typeof untagPhotoSubject,
): Promise<AlbumManageResult> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (viewerPersonId(ctx) === null) return { error: hub.actions.notSignedIn };

  const photoId = formData.get("photoId");
  const personId = formData.get("personId");
  if (typeof photoId !== "string" || !photoId || typeof personId !== "string" || !personId) {
    return { error: hub.actions.invalidInput };
  }

  try {
    const decision = await untag(db, ctx, { photoId, personId });
    if (!decision.allowed) return { error: hub.album.tagRemoveError };
    revalidatePath("/hub/album");
    return { ok: true };
  } catch {
    return { error: hub.album.tagRemoveError };
  }
}

/** Tag a Person as a SUBJECT (who the photo is about). Returns the minted id. SEE-gated in core. */
export async function tagPhotoSubjectAction(
  formData: FormData,
): Promise<PhotoTagPersonActionResult> {
  return tagPhotoPersonGroup(formData, tagPhotoSubject);
}

/** Untag a subject Person from a photo. SEE-gated, idempotent. */
export async function untagPhotoSubjectAction(formData: FormData): Promise<AlbumManageResult> {
  return untagPhotoPersonGroup(formData, untagPhotoSubject);
}

/** Tag a Person as APPEARING in a photo (distinct from subjects). Returns the minted id. SEE-gated. */
export async function tagPhotoPersonAction(
  formData: FormData,
): Promise<PhotoTagPersonActionResult> {
  return tagPhotoPersonGroup(formData, tagPhotoPerson);
}

/** Untag an appears-in Person from a photo. SEE-gated, idempotent. */
export async function untagPhotoPersonAction(formData: FormData): Promise<AlbumManageResult> {
  return untagPhotoPersonGroup(formData, untagPhotoPerson);
}

/**
 * Tag a photo with a place: EITHER an existing `placeId` OR a `newPlaceName` (with an optional
 * `familyId` to disambiguate the target album when the photo is placed in several). Returns the
 * tagged (or freshly created) place id. A DENY → error; a thrown InvariantViolation (ambiguous
 * family, foreign/unknown place id, empty name) is caught → error.
 */
export async function tagPhotoPlaceAction(
  formData: FormData,
): Promise<PhotoTagPlaceActionResult> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (viewerPersonId(ctx) === null) return { error: hub.actions.notSignedIn };

  const photoId = formData.get("photoId");
  const placeId = formData.get("placeId");
  const newPlaceName = formData.get("newPlaceName");
  const familyId = formData.get("familyId");
  if (typeof photoId !== "string" || !photoId) {
    return { error: hub.actions.invalidInput };
  }
  const hasExisting = typeof placeId === "string" && placeId.length > 0;
  const hasNew = typeof newPlaceName === "string" && newPlaceName.trim().length > 0;
  if (hasExisting === hasNew) return { error: hub.actions.invalidInput };

  try {
    const result = await tagPhotoPlace(db, ctx, {
      photoId,
      ...(hasExisting ? { placeId: placeId as string } : {}),
      ...(hasNew ? { newPlaceName: (newPlaceName as string).trim() } : {}),
      ...(typeof familyId === "string" && familyId ? { familyId } : {}),
    });
    if (!result.allowed || result.placeId === undefined) {
      return { error: hub.album.tagSaveError };
    }
    revalidatePath("/hub/album");
    return { placeId: result.placeId };
  } catch {
    return { error: hub.album.tagSaveError };
  }
}

/** Untag a place from a photo. SEE-gated, idempotent. */
export async function untagPhotoPlaceAction(
  formData: FormData,
): Promise<AlbumManageResult> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (viewerPersonId(ctx) === null) return { error: hub.actions.notSignedIn };

  const photoId = formData.get("photoId");
  const placeId = formData.get("placeId");
  if (typeof photoId !== "string" || !photoId || typeof placeId !== "string" || !placeId) {
    return { error: hub.actions.invalidInput };
  }

  try {
    const decision = await untagPhotoPlace(db, ctx, { photoId, placeId });
    if (!decision.allowed) return { error: hub.album.tagRemoveError };
    revalidatePath("/hub/album");
    return { ok: true };
  } catch {
    return { error: hub.album.tagRemoveError };
  }
}

/**
 * Replace the set of family albums a photo is placed in. MANAGE-gated in core (contributor or
 * steward). Reads repeated `familyIds` FormData entries (same pattern as `retargetStoryFamiliesAction`).
 * A DENY → error; a thrown InvariantViolation (empty set, a family the viewer isn't an active member
 * of) is caught → error.
 */
export async function retargetPhotoFamiliesAction(
  formData: FormData,
): Promise<AlbumManageResult> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (viewerPersonId(ctx) === null) return { error: hub.actions.notSignedIn };

  const photoId = formData.get("photoId");
  const familyIds = formData.getAll("familyIds").map((id) => String(id));
  if (typeof photoId !== "string" || !photoId) {
    return { error: hub.actions.invalidInput };
  }

  try {
    const decision = await retargetPhotoFamilies(db, ctx, { photoId, familyIds });
    if (!decision.allowed) return { error: hub.actions.notAllowedToManagePhoto };
    revalidatePath("/hub/album");
    return { ok: true };
  } catch {
    return { error: hub.album.retargetError };
  }
}

/**
 * Everything the tag panel needs in ONE call: the SEE-gated photo detail plus the viewer's typeahead
 * suggestions. Returns `{ error }` if the photo isn't viewable (getAlbumPhotoDetail returns null).
 *
 * Suggestions:
 *   - people/families reuse the SAME source the story editor uses (`loadTagSuggestionsAction`): the
 *     viewer's active families, and the union of their kin across those families (identified rows
 *     only, deduped by personId).
 *   - places = the union of `listPlacesForFamily` across the PHOTO's placement families, deduped by
 *     placeId (each core call is itself membership-gated, so a family the viewer isn't in contributes
 *     nothing).
 */
export type PhotoTagPanel = {
  detail: AlbumPhotoDetailView;
  suggestions: {
    people: { personId: string; displayName: string }[];
    families: { id: string; name: string }[];
    places: { placeId: string; name: string }[];
  };
};

export async function loadPhotoTagPanelAction(
  photoId: string,
): Promise<PhotoTagPanel | { error: string }> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  const person = viewerPersonId(ctx);
  if (person === null) return { error: hub.actions.notSignedIn };

  const detail = await getAlbumPhotoDetail(db, ctx, photoId);
  if (detail === null) return { error: hub.album.tagPanelLoadError };

  // People/families suggestions — identical source to the story editor's loadTagSuggestionsAction.
  const families = await listActiveFamiliesForPerson(db, person);
  const kinLists = await Promise.all(
    families.map((fam) => listMyKin(db, ctx, fam.familyId)),
  );
  const peopleById = new Map<string, string>();
  for (const kin of kinLists) {
    for (const k of kin) {
      if (k.identified && k.displayName) peopleById.set(k.personId, k.displayName);
    }
  }

  // Places = union across the photo's placement families (each membership-gated), deduped by id.
  const placeLists = await Promise.all(
    detail.families.map((f) => listPlacesForFamily(db, ctx, f.familyId)),
  );
  const placesById = new Map<string, string>();
  for (const list of placeLists) {
    for (const p of list) placesById.set(p.placeId, p.name);
  }

  return {
    detail,
    suggestions: {
      people: [...peopleById].map(([personId, displayName]) => ({ personId, displayName })),
      families: families.map((f) => ({ id: f.familyId, name: f.familyName })),
      places: [...placesById].map(([placeId, name]) => ({ placeId, name })),
    },
  };
}
