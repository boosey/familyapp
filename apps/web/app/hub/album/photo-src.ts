/**
 * Album-photo byte-route URL builder (issue #139 thumbnails).
 *
 * The audited serve route `/api/album-photo/[photoId]` returns full-resolution bytes by default and a
 * downscaled thumbnail variant when asked (`?variant=thumb`). The grid/list tiles want the thumbnail
 * (a full-res phone photo the browser then scales to a ~140px tile is a large, wasteful transfer); the
 * full-size viewer and detail surfaces want the original. Both go through the SAME route, so the auth
 * gate is identical either way — the variant only chooses which bytes the (already-authorized) route
 * returns.
 *
 * This module is deliberately client-safe (no `sharp`, no `server-only`): it is imported by client
 * components to build the `<img src>`. The server-side generation lives in `@/lib/thumbnail`.
 */

/** The query-param NAME the serve route reads to pick a variant. Single source for route + callers. */
export const ALBUM_PHOTO_VARIANT_PARAM = "variant";
/** The query-param VALUE that selects the downscaled thumbnail. Absent ⇒ full-resolution original. */
export const ALBUM_PHOTO_THUMB_VARIANT = "thumb";

/**
 * Build the byte-route URL for a photo. `thumb: true` requests the downscaled grid variant; omitted (or
 * false) yields the full-resolution original. The id is a server-minted UUID (URL-safe), so it is not
 * re-encoded — keeping byte-for-byte parity with the historical `/api/album-photo/${id}` literal.
 */
export function albumPhotoSrc(photoId: string, opts?: { thumb?: boolean }): string {
  const base = `/api/album-photo/${photoId}`;
  return opts?.thumb
    ? `${base}?${ALBUM_PHOTO_VARIANT_PARAM}=${ALBUM_PHOTO_THUMB_VARIANT}`
    : base;
}
