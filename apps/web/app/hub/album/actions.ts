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
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { extractPhotoExif, type PhotoExif } from "@/app/hub/album/exif";
import { hub } from "@/app/_copy";

export type AlbumUploadResult = { ok: true; photoId: string } | { error: string };

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
