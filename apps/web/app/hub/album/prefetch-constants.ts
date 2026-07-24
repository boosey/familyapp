/**
 * Album thumbnail-prefetch tuning (#371).
 *
 * On EVERY hub load the shell warms the browser's cache with the first screenful of album thumbnails
 * (server-rendered `<link rel="prefetch" as="image">`, see {@link ThumbPrefetchLinks}) so switching to
 * the Album tab paints instantly. This bounds HOW MANY are warmed — deliberately small (one screenful),
 * NOT the whole album, so it never re-introduces the ~500-at-once burst #219 fixed.
 *
 * This is a JS-used bound (a `.slice(0, n)` limit + a core-read `limit`), so it lives as a TS constant —
 * the single source of truth for the warm size (repo convention: numbers used in JS math are constants,
 * never duplicated hardcoded literals).
 */

/** How many album thumbnails to warm on hub load — roughly one screenful at the default thumb size. */
export const ALBUM_WARM_FIRST_SCREEN = 24;
