/**
 * Deterministic per-story card layout picker for the Scrapbook masonry feed.
 *
 * The approved "Scrapbook & warm" mockup mixes card layouts so the feed reads like an editorial
 * scrapbook rather than the same photo-top tile repeating. This module assigns each story a layout
 * that is (a) CONSTRAINED by the story's actual photos — a photo layout is never chosen for a
 * photoless story — and (b) VARIED by a stable hash of the story id, so the same story always gets
 * the same layout (no reshuffle on reload / re-render) while different stories spread across the
 * available variants.
 *
 * Pure + side-effect-free: layout is a function of `id` + photo count only. Guarded by
 * story-layout.test.ts.
 */
import type { StoryItem } from "./story-browse-types";

/** The card layout variants (see StoryCard / StoryCard.module.css for the rendered structure). */
export type StoryLayout = "top" | "left" | "wrap" | "collage" | "textonly";

// Photo-count → candidate layouts. The picked layout is group[hash % group.length].
//   • 1 photo  → photo-top | photo-left | text-wrap (contrast between the three single-photo looks)
//   • 2+ photos → collage | photo-top (collage needs ≥2; photo-top stays in rotation for contrast)
// 0 photos is handled directly (textonly) — no group needed.
const ONE_PHOTO_LAYOUTS: readonly StoryLayout[] = ["top", "left", "wrap"];
const MULTI_PHOTO_LAYOUTS: readonly StoryLayout[] = ["collage", "top"];

/**
 * FNV-1a 32-bit hash of a string → an unsigned 32-bit integer. Deterministic and well-spread across
 * short ids, which is all we need to index into a 2–3 element layout group. `>>> 0` keeps it unsigned
 * so `% group.length` is always non-negative.
 */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h * 16777619, done with shifts/adds to stay in 32-bit range without overflowing to a float.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** How many renderable photos the story has (cover + non-cover). No cover ⇒ 0 (text-only card). */
function photoCount(item: StoryItem): number {
  if (!item.coverPhotoId) return 0;
  // photoIds includes the cover; guard against an empty photoIds by counting the cover itself.
  return Math.max(1, item.photoIds.length);
}

/** Pick the deterministic layout for a story, constrained by its photo count then varied by id hash. */
export function pickStoryLayout(item: StoryItem): StoryLayout {
  const count = photoCount(item);
  if (count === 0) return "textonly";
  const group = count >= 2 ? MULTI_PHOTO_LAYOUTS : ONE_PHOTO_LAYOUTS;
  return group[hash32(item.id) % group.length]!;
}
