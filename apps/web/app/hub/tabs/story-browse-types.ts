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
  /** Base detail href, e.g. "/hub/stories/{id}". Mode/scope query is appended at click time. */
  href: string;
}
