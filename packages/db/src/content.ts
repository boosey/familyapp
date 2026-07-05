/**
 * GUARDED content tables — the expressive artifacts the spec puts behind the single front door.
 *
 * The `stories`/`media` (Story/Media), `family_photos`/`family_photo_families` (album, ADR-0009),
 * and `story_images` (accompaniment — the photos shown alongside a story, ADR-0009) table objects
 * are reachable ONLY through this subpath, and an architecture test
 * (packages/core/test/architecture.test.ts) fails CI if any production source file outside the
 * audited allowlist imports it. All content reads go through @chronicle/core's authorization
 * functions; all content writes go through @chronicle/core's repositories. `story_images` is
 * guarded because a `private` story's imagery must not leak (its attachment links are visible only
 * when the parent story is — ADR-0009 authz). Identity/relationship tables (persons, memberships,
 * ...) are NOT here — they live in @chronicle/db/schema and are freely importable.
 */
export {
  media,
  stories,
  proseRevisions,
  storyRecordings,
  familyPhotos,
  familyPhotoFamilies,
  storyImages,
  storyFavorites,
  storyLikes,
} from "./schema";
