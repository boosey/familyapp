"use server";

/**
 * Album upload server action (ADR-0009 · #15). Like every hub action, it re-resolves auth on the
 * server — the contributor's identity is NEVER trusted from the client; only the file bytes come in
 * via FormData. The bytes are written to object storage FIRST (write-once `family-photos/<uuid>`
 * key), then `createAlbumPhoto` records the row + album membership. Photos are NOT `media` — no
 * media row, not under the immutability trigger (ADR-0009).
 *
 * #15 scope: SINGLE-family placement. The target family is resolved from the contributor's OWN
 * active memberships (so they are always an active member of the album they place into). EXIF is
 * left null here — #17 populates it at import.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  createAlbumPhoto,
  listActiveMembershipsForPerson,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";

export type AlbumUploadResult = { ok: true; photoId: string } | { error: string };

export async function uploadAlbumPhotoAction(
  formData: FormData,
): Promise<AlbumUploadResult> {
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  // Resolve the contributor's target family from their OWN active memberships. #15 places into
  // exactly one album; if the contributor is in several families, pick deterministically (lowest id)
  // and leave the choice to the #16 family picker.
  const memberships = await listActiveMembershipsForPerson(db, ctx.personId);
  if (memberships.length === 0) return { error: hub.actions.noFamily };
  // #16: replace this deterministic pick with a family picker (multi-family placement).
  const familyId = memberships
    .map((m) => m.familyId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0]!;

  const photo = formData.get("photo");
  if (!(photo instanceof Blob) || photo.size === 0) {
    return { error: hub.actions.photoEmpty };
  }
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const contentType = photo.type || "application/octet-stream";
  const storageKey = `family-photos/${randomUUID()}`;

  try {
    await storage.put({ key: storageKey, bytes, contentType });
    const created = await createAlbumPhoto(db, {
      contributorPersonId: ctx.personId,
      familyIds: [familyId],
      source: "upload",
      storageKey,
      caption: null,
    });
    revalidatePath("/hub/album");
    return { ok: true, photoId: created.id };
  } catch {
    return { error: hub.actions.photoUploadFailed };
  }
}
