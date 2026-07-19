"use server";

/**
 * Server action backing the Ask surface's OPTIONAL photo picker (ADR-0009 Phase 3 "tell the story of
 * THIS photo"). Like every hub action it re-resolves auth SERVER-side (`getCurrentAuthContext()`) —
 * the client is NEVER trusted for identity — and lists ONLY the asker's own visible album photos, so
 * the picker can never offer a photo the asker can't see. It mirrors the album-listing half of
 * `loadStoryPhotoEditorAction` (photo-actions.ts): every family the asker actively contributes to,
 * deduped by photo id.
 *
 * This is a READ used to POPULATE the picker; the authoritative gate on what may be attached lives in
 * `createAsk` (it re-runs `assertPersonCanAccessAlbumPhoto` per id inside its write transaction), so a
 * crafted submission of an unseeable id is rejected there regardless of what this returned.
 */
import {
  listActiveFamiliesForPerson,
  listAlbumPhotos,
  ALBUM_PHOTO_QUERY_CAP,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { capAlbumUnion, warnAlbumCapHit } from "@/lib/album-cap";
import { hub } from "@/app/_copy";

/** One album photo the asker may attach to a question. */
export interface AskAlbumPhoto {
  photoId: string;
  caption: string | null;
}

export type AskPhotoOptions =
  | { ok: true; album: AskAlbumPhoto[] }
  | { error: string };

export async function loadAskPhotoOptionsAction(): Promise<AskPhotoOptions> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  try {
    const families = await listActiveFamiliesForPerson(db, ctx.personId);
    const seen = new Set<string>();
    // Collect createdAt too so the union can be capped most-recent-first (#217). Each per-family read
    // is already DB-capped; this bounds the DEDUPED UNION that crosses to the picker.
    const collected: { photoId: string; caption: string | null; createdAt: Date }[] = [];
    for (const fam of families) {
      const photos = await listAlbumPhotos(db, ctx, fam.familyId);
      for (const p of photos) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        collected.push({ photoId: p.id, caption: p.caption, createdAt: p.createdAt });
      }
    }
    const { rows, capped } = capAlbumUnion(collected);
    if (capped) warnAlbumCapHit("ask-photo-picker", ALBUM_PHOTO_QUERY_CAP, collected.length);
    const album: AskAlbumPhoto[] = rows.map((r) => ({ photoId: r.photoId, caption: r.caption }));
    return { ok: true, album };
  } catch {
    return { error: hub.ask.photoPickerLoadError };
  }
}
