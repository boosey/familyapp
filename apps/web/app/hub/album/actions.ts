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
  listActiveFamiliesForPerson,
  setAlbumPhotoCaption,
  softDeleteAlbumPhoto,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { extractPhotoExif, type PhotoExif } from "@/app/hub/album/exif";
import { hub } from "@/app/_copy";

export type AlbumUploadResult = { ok: true; photoId: string } | { error: string };

/** Result of a caption edit / delete: success, or a user-facing error string. */
export type AlbumManageResult = { ok: true } | { error: string };

/** The longest caption we accept (it doubles as alt text — a label, not prose). */
const MAX_CAPTION_LENGTH = 500;

export async function uploadAlbumPhotoAction(
  formData: FormData,
): Promise<AlbumUploadResult> {
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
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

  const photo = formData.get("photo");
  if (!(photo instanceof Blob) || photo.size === 0) {
    return { error: hub.actions.photoEmpty };
  }
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const contentType = photo.type || "application/octet-stream";
  const storageKey = `family-photos/${randomUUID()}`;

  // #17: read capture-date + GPS from the SAME bytes (no second round-trip). The helper never
  // throws, but keep the extraction OUTSIDE the storage/db try and belt-and-suspenders it anyway, so
  // even a hypothetical future throw yields null EXIF + a successful upload — never a failed upload.
  let exif: PhotoExif = { capturedAt: null, gps: null };
  try {
    exif = await extractPhotoExif(bytes);
  } catch {
    /* never fail the upload on EXIF */
  }

  try {
    await storage.put({ key: storageKey, bytes, contentType });
    const created = await createAlbumPhoto(db, {
      contributorPersonId: ctx.personId,
      familyIds,
      source: "upload",
      storageKey,
      caption: null,
      exifCapturedAt: exif.capturedAt,
      exifGps: exif.gps,
    });
    revalidatePath("/hub/album");
    return { ok: true, photoId: created.id };
  } catch {
    return { error: hub.actions.photoUploadFailed };
  }
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
