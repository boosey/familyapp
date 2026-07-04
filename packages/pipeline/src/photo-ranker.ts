/**
 * Story Imagery — deterministic photo-suggestion ranker (ADR-0009, Phase 4 · Slice A).
 *
 * A cheap, PURE engine that ranks a draft story's candidate album photos by
 * (caption-text overlap ∪ EXIF-capture-date proximity to the story's era year), plus a
 * caption-driven "add this photo?" nudge decision. No DB, no AI, no vendor SDKs, no clock,
 * no randomness — same inputs always produce identical output.
 *
 * Degradation is the COMMON case: `eraYear` is frequently null (nothing auto-derives it) and
 * `exifCapturedAt` is commonly null (EXIF often stripped). Both arms must no-op gracefully; when
 * nothing scores, the output preserves the input (recency) order with `score: 0`.
 *
 * The reserved `PhotoUnderstanding` vision seam (contracts.ts) is deliberately NOT consumed here —
 * a future subscription-gated ranker will use it; the v1 ranker is deterministic-only.
 */

export const PHOTO_RANK_CAPTION_WEIGHT = 1.0;
export const PHOTO_RANK_YEAR_WEIGHT = 0.5;
/** Years of EXIF-vs-era distance beyond which the year arm contributes nothing. */
export const PHOTO_RANK_YEAR_WINDOW = 10;
/** Minimum caption-token overlap for `pickPhotoNudge` to surface a suggestion. */
export const PHOTO_NUDGE_MIN_OVERLAP = 1;

export interface PhotoCandidate {
  id: string;
  caption: string | null;
  exifCapturedAt: Date | null;
}

export interface StorySignals {
  text: string;
  eraYear: number | null;
}

export interface RankedPhoto {
  id: string;
  caption: string | null;
  /** Weighted total; 0 when neither arm fires. */
  score: number;
  /** Count of shared meaningful tokens between story text and caption. */
  captionOverlap: number;
  /** 0..1 closeness of EXIF year to era year, or null when no usable date signal. */
  yearProximity: number | null;
}

/**
 * Common English function words dropped before overlap counting so a shared "the"/"and" never
 * inflates a match. Applied to BOTH story text and captions.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "was", "with", "that", "this", "for", "from", "her", "his",
  "had", "have", "were", "are", "you", "but", "not", "they", "she", "him",
  "our", "out", "all", "one", "who", "its", "been", "then", "them", "there",
  "when", "what", "which", "into", "your", "would", "could", "their", "about",
]);

/**
 * Lowercase, split on non-alphanumeric, drop tokens shorter than 3 chars and any stopword.
 * Returns a deduped set of meaningful tokens.
 */
function tokenize(text: string | null): Set<string> {
  if (!text) return new Set();
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/i)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/** Count of `queryTokens` present in the caption's tokens. */
function captionOverlapCount(queryTokens: Set<string>, caption: string | null): number {
  if (!caption) return 0;
  const captionTokens = tokenize(caption);
  let n = 0;
  for (const q of queryTokens) if (captionTokens.has(q)) n++;
  return n;
}

/**
 * Rank candidate photos for a draft story. Output length ALWAYS equals input length (no candidate
 * is ever dropped). Sorted by `score` DESC; ties broken by original input index ASC (candidates
 * arrive recency-ordered), implemented explicitly rather than relying on Array.sort stability.
 */
export function rankPhotosForStory(
  signals: StorySignals,
  candidates: PhotoCandidate[],
): RankedPhoto[] {
  const queryTokens = tokenize(signals.text);
  const eraYear = signals.eraYear;

  const ranked = candidates.map((c, idx) => {
    const captionOverlap = captionOverlapCount(queryTokens, c.caption);

    let yearProximity: number | null = null;
    if (eraYear != null && c.exifCapturedAt != null) {
      const distance = Math.abs(c.exifCapturedAt.getUTCFullYear() - eraYear);
      yearProximity = Math.max(0, 1 - distance / PHOTO_RANK_YEAR_WINDOW);
    }

    const score =
      PHOTO_RANK_CAPTION_WEIGHT * captionOverlap +
      PHOTO_RANK_YEAR_WEIGHT * (yearProximity ?? 0);

    return { id: c.id, caption: c.caption, score, captionOverlap, yearProximity, idx };
  });

  ranked.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

  return ranked.map(({ idx: _idx, ...rest }) => rest);
}

/**
 * Caption-driven "add this photo?" nudge. Returns the top-ranked photo IFF it exists AND its
 * caption overlap meets the threshold. A strong PURE date match (captionOverlap 0) yields null —
 * we only nudge on textual evidence the photo belongs with this story.
 */
export function pickPhotoNudge(
  ranked: RankedPhoto[],
): { photoId: string; caption: string | null } | null {
  const top = ranked[0];
  if (!top) return null;
  if (top.captionOverlap < PHOTO_NUDGE_MIN_OVERLAP) return null;
  return { photoId: top.id, caption: top.caption };
}
