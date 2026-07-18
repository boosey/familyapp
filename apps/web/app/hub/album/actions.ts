"use server";

/**
 * Album upload server actions (ADR-0009 · #15 · issue #20 direct-to-storage).
 *
 * Photo bytes NO LONGER transit a Server Action — they go browser → object storage directly, so the
 * two body caps that used to 413 realistic phone photos (Next's Server-Action limit and Vercel's
 * unraisable ~4.5 MB request-body cap) are gone. The server only ever handles METADATA, in two steps:
 *
 *   1. `requestAlbumUploadAction({ contentType })` — re-resolve auth (identity is NEVER trusted from
 *      the client), require ≥1 active family, validate the client-declared `contentType` is an
 *      allowed image type, mint a fresh `family-photos/<uuid>` key, produce a direct-upload target
 *      from the active MediaStorage adapter (presigned PUT on R2 / dev-receiver URL locally), and mint
 *      a short-lived HMAC ticket binding `{ key, personId, exp }`.
 *   2. Client PUTs the bytes straight to the target.
 *   3. `recordAlbumPhotoAction({ key, familyIds, ticket })` — re-resolve auth, VERIFY the ticket (HMAC
 *      ok, unexpired, minter === caller, key matches), re-validate `familyIds` against the caller's
 *      OWN active memberships (unchanged posture — a spoofed/foreign family id is dropped), confirm the
 *      object EXISTS (never record a phantom key), read the JUST-STORED bytes and extract EXIF
 *      server-side (unchanged trust model), then `createAlbumPhoto`.
 *
 * The family re-validation and the "bytes are read/EXIF'd server-side from what STORAGE holds" trust
 * model are preserved exactly from the old body-transit actions.
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
import { isAllowedImageContentType, type UploadTarget } from "@chronicle/storage";
import { getRuntime } from "@/lib/runtime";
import { createUploadTicket, verifyUploadTicket } from "@/lib/upload-ticket";
import { warmThumbnail } from "@/lib/thumbnail";
import { extractPhotoExif, type PhotoExif } from "@/app/hub/album/exif";
import { hub } from "@/app/_copy";
import type { ImportOnePhotoResult } from "./import-progress";

/** Result of a caption edit / delete: success, or a user-facing error string. */
export type AlbumManageResult = { ok: true } | { error: string };

/** The longest caption we accept (it doubles as alt text — a label, not prose). */
const MAX_CAPTION_LENGTH = 500;

/** The storage keyspace album photos live in (issue #20 — mint + validate against this prefix). */
const ALBUM_PHOTO_KEY_PREFIX = "family-photos/";

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

/**
 * Resolve the target album set from the client's picker choice, re-validated against the caller's OWN
 * active memberships (client-submitted ids are NEVER trusted). Returns the resolved ids, or an error
 * token — the EXACT posture the old body-transit actions used, factored out so `requestAlbumUpload`
 * and `recordAlbumPhoto` share one implementation.
 */
function resolveTargetFamilies(
  submitted: string[],
  active: { familyId: string }[],
): { familyIds: string[] } | { error: string } {
  if (active.length === 0) return { error: hub.actions.noFamily };
  const allowed = new Set(active.map((f) => f.familyId));
  const chosen = [...new Set(submitted.filter((id) => allowed.has(id)))];
  if (chosen.length > 0) return { familyIds: chosen };
  if (allowed.size === 1) return { familyIds: [active[0]!.familyId] }; // solo → sole family
  return { error: hub.actions.noAlbumChosen }; // multi-family with no valid selection
}

/**
 * Step 1 — mint a direct-to-storage upload target + HMAC ticket for ONE photo (issue #20). Re-resolves
 * auth, requires ≥1 active family, and validates the declared image content type BEFORE presigning (so
 * a presigned target — which binds Content-Type — can only ever exist for an allowed image type). The
 * key is server-minted and fresh; the client never chooses it.
 */
export type RequestAlbumUploadResult =
  | { ok: true; key: string; upload: UploadTarget; ticket: string }
  | { error: string };

export async function requestAlbumUploadAction(input: {
  contentType: string;
}): Promise<RequestAlbumUploadResult> {
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  // Server Actions can be invoked by a malformed/malicious client with a missing or non-string
  // argument; guard before we dereference `input.contentType`.
  if (!input || typeof input.contentType !== "string") {
    return { error: hub.actions.invalidInput };
  }

  // Require ≥1 active family up front (matches the old action's noFamily guard) — no point minting a
  // target the caller could never `record` into.
  const active = await listActiveFamiliesForPerson(db, ctx.personId);
  if (active.length === 0) return { error: hub.actions.noFamily };

  const contentType = (input.contentType || "").trim();
  if (!isAllowedImageContentType(contentType)) {
    return { error: hub.actions.photoTypeUnsupported };
  }

  const key = `${ALBUM_PHOTO_KEY_PREFIX}${randomUUID()}`;
  let upload: UploadTarget;
  try {
    upload = await storage.createUploadTarget({ key, contentType });
  } catch (err) {
    console.error(
      `[album/upload] createUploadTarget failed for ${key} (${contentType}):`,
      err instanceof Error ? err.message : String(err),
    );
    return { error: hub.actions.photoUploadFailedDetail(sanitizeStorageErrorDetail(err)) };
  }
  const ticket = createUploadTicket({ key, personId: ctx.personId });
  return { ok: true, key, upload, ticket };
}

/**
 * Step 3 — record the album row for a photo the client has ALREADY PUT into storage (issue #20). The
 * bytes never come through here. Security gates, in order:
 *   - re-resolve auth (identity never trusted from the client);
 *   - VERIFY the HMAC ticket: server-minted + unexpired, minter === caller, and the ticket's key
 *     equals the submitted key — so `record` can't be driven with a forged or foreign key;
 *   - the key must be in the `family-photos/` keyspace;
 *   - re-validate `familyIds` against the caller's OWN active memberships (spoofed/foreign dropped);
 *   - the object must EXIST in storage (never record a phantom key);
 *   - EXIF is read from the STORED bytes server-side (unchanged trust model) and never fails the record.
 */
export async function recordAlbumPhotoAction(
  formData: FormData,
): Promise<ImportOnePhotoResult> {
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  // Guard against a malformed invocation before touching `formData.get` (a client could POST a
  // non-FormData argument).
  if (!formData || typeof formData.get !== "function") {
    return { error: hub.actions.invalidInput };
  }

  const key = formData.get("key");
  const ticket = formData.get("ticket");
  if (typeof key !== "string" || !key || typeof ticket !== "string" || !ticket) {
    return { error: hub.actions.invalidInput };
  }

  // Ticket must be valid, unexpired, minted by THIS caller, and bound to THIS key.
  const verified = verifyUploadTicket(ticket);
  if (!verified || verified.personId !== ctx.personId || verified.key !== key) {
    return { error: hub.actions.uploadTicketInvalid };
  }
  // Defense in depth: the key must be in the album keyspace (the mint prefixes it, the ticket binds
  // it, but never trust a single check on a write surface of the front door).
  if (!key.startsWith(ALBUM_PHOTO_KEY_PREFIX)) {
    return { error: hub.actions.uploadTicketInvalid };
  }

  const active = await listActiveFamiliesForPerson(db, ctx.personId);
  const submitted = formData
    .getAll("familyIds")
    .filter((v): v is string => typeof v === "string");
  const resolved = resolveTargetFamilies(submitted, active);
  if ("error" in resolved) return { error: resolved.error };
  const { familyIds } = resolved;

  // Read the JUST-STORED bytes: this both CONFIRMS the object exists (never record a phantom key) and
  // gives us the authoritative bytes to EXIF server-side — the same trust model as before, just from
  // storage instead of the request body.
  const bytes = await storage.getBytes(key);
  if (!bytes) return { error: hub.actions.uploadObjectMissing };

  let exif: PhotoExif = { capturedAt: null, gps: null };
  try {
    exif = await extractPhotoExif(bytes);
  } catch {
    /* never fail the record on EXIF */
  }

  let photoId: string;
  try {
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: ctx.personId,
      familyIds,
      source: "upload",
      storageKey: key,
      caption: null,
      exifCapturedAt: exif.capturedAt,
      exifGps: exif.gps,
    });
    photoId = photo.id;
  } catch (err) {
    console.error(
      `[album/upload] record failed for ${key}:`,
      err instanceof Error ? err.message : String(err),
    );
    // The object is already in storage but no row references it. A retry mints a FRESH key, so this
    // one would leak as a write-once orphan forever. Best-effort delete it (swallow any failure —
    // a leaked blob is harmless; a failed cleanup must not mask the real create error).
    try {
      await storage.delete(key);
    } catch {
      /* best-effort orphan cleanup */
    }
    return { error: hub.actions.photoUploadFailedDetail(sanitizeStorageErrorDetail(err)) };
  }

  // Generate the grid thumbnail NOW, from the bytes already in memory (issue #139) — so the optimistic
  // tile, which requests `?variant=thumb`, has a thumbnail waiting instead of forcing a first-view lazy
  // generation. Best-effort and awaited: `warmThumbnail` never throws, and awaiting guarantees the write
  // completes before this serverless invocation may freeze. A miss here is harmless — the serve route
  // regenerates lazily.
  await warmThumbnail(storage, key, bytes);

  revalidatePath("/hub");
  revalidatePath("/hub/album");
  // Return the new id so the board renders this tile's real bytes optimistically (ADR-0015).
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
    // rejection in the client transition (mirrors the record action's photoUploadFailed guard).
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
    families: { id: string; name: string; shortName?: string | null }[];
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
      families: families.map((f) => ({
        id: f.familyId,
        name: f.familyName,
        shortName: f.familyShortName,
      })),
      places: [...placesById].map(([placeId, name]) => ({ placeId, name })),
    },
  };
}
