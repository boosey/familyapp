/**
 * Shared contract between the Stories-tab producer (`StoriesTab.tsx`, server) and the client browse
 * surface (`StoryBrowse.tsx`). Frozen deliberately: every field here is serializable so the server
 * component can hand it straight to the client component with no Map/Date round-trips.
 *
 * The design ("Story Browse (Hub)") is three modes of one surface — Feed / Timeline / Search — plus
 * a family-scope filter and a Read view (the restyled /hub/stories/[id] route). See
 * docs/design-system/.../HANDOFF-browse-and-family-flows.md.
 */

/** One of the viewer's active families — the options for the family-scope filter. */
export interface ViewerFamily {
  id: string;
  name: string;
  /** Steward-set brief label (ADR-0021), rendered by the filter chips in place of `name` when set.
   *  Optional/nullable — the story-card family labels (which reuse this shape) keep the formal name. */
  shortName?: string | null;
}

export interface StoryItem {
  id: string;
  title: string;
  summary: string | null;
  /**
   * Rendered prose — part of the client search haystack (title + summary + prose + narrator +
   * era/place + tags). Transcript is intentionally NOT shipped/searched client-side (would send
   * every transcript to the browser); transcript search is deferred to a server-side pass.
   */
  prose: string | null;
  tags: string[];
  personId: string;
  personName: string;
  /** The year the story is ABOUT. Null → the story is Undated (its own Timeline section). */
  eraYear: number | null;
  /** Optional place/era note the narrator gave, e.g. "Naples" / "Cherry Street". */
  eraLabel: string | null;
  /** Combined era·place display label, e.g. "1962 · MARCH". Null when the story is undated. */
  eventLabel: string | null;
  /**
   * Families this story is targeted to, ALREADY INTERSECTED with the viewer's active families
   * (display-safety — a card never names a family the viewer isn't in). May be empty.
   */
  families: ViewerFamily[];
  /** New to this viewer: not the viewer's own story and not yet opened. Drives the "New" badge. */
  isNew: boolean;
  /**
   * The `family_photo_id` of the story's cover accompaniment image (ADR-0009), sourced batched via
   * the `loadStoryCovers` core seam. Null when the story has no attached image — a text-only card is
   * first-class and shows NO placeholder. Rendered through the audited `/api/album-photo/[photoId]`
   * byte route, which re-checks read authorization for the story's audience.
   */
  coverPhotoId: string | null;
  /**
   * ALL of the story's renderable accompaniment photo ids in render order (cover first), sourced
   * batched via the `loadStoryGalleryPhotoIds` core seam. The feed card renders the cover big and the
   * remaining (non-cover) ids as a small thumbnail row below the tags. `coverPhotoId` is the first
   * element when present; the card derives the non-cover set by excluding `coverPhotoId`. Empty when
   * the story has no renderable image (text-only card).
   */
  photoIds: string[];
  /** Base detail href, e.g. "/hub/stories/{id}". Mode/scope query is appended at click time. */
  href: string;
}
