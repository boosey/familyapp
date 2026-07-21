import { describe, expect, it } from "vitest";
import {
  PHOTO_NUDGE_MIN_OVERLAP,
  PHOTO_RANK_CAPTION_WEIGHT,
  PHOTO_RANK_YEAR_WEIGHT,
  PHOTO_RANK_YEAR_WINDOW,
  pickPhotoNudge,
  rankPhotosForStory,
  type PhotoCandidate,
} from "../src/photo-ranker";

/** A UTC Date pinned to Jan 1 of `year` — the ranker reads only getUTCFullYear(). */
function yearDate(year: number): Date {
  return new Date(Date.UTC(year, 0, 1));
}

describe("rankPhotosForStory — caption arm", () => {
  it("ranks a matching caption above a non-matching one", () => {
    const candidates: PhotoCandidate[] = [
      { id: "no-match", caption: "a completely unrelated picture", exifCapturedAt: null },
      { id: "match", caption: "grandpa fishing at the lake", exifCapturedAt: null },
    ];
    const ranked = rankPhotosForStory(
      { text: "We went fishing with grandpa every summer", occurredDate: null },
      candidates,
    );
    expect(ranked.map((r) => r.id)).toEqual(["match", "no-match"]);
    expect(ranked[0]!.captionOverlap).toBeGreaterThanOrEqual(2); // "grandpa", "fishing"
    expect(ranked[1]!.captionOverlap).toBe(0);
    expect(ranked[1]!.score).toBe(0);
  });

  it("ignores stopwords and short tokens when counting overlap", () => {
    const ranked = rankPhotosForStory(
      { text: "the a of and to", occurredDate: null },
      [{ id: "p", caption: "the a of an it", exifCapturedAt: null }],
    );
    expect(ranked[0]!.captionOverlap).toBe(0);
    expect(ranked[0]!.score).toBe(0);
    expect(ranked[0]!.yearProximity).toBeNull();
  });
});

describe("rankPhotosForStory — year arm", () => {
  it("ranks a nearer capture year above a farther one", () => {
    const candidates: PhotoCandidate[] = [
      { id: "far", caption: null, exifCapturedAt: yearDate(1974) }, // dist 6 -> 0.4
      { id: "near", caption: null, exifCapturedAt: yearDate(1982) }, // dist 2 -> 0.8
    ];
    const ranked = rankPhotosForStory({ text: "no caption words here", occurredDate: "1980-01-01" }, candidates);
    expect(ranked.map((r) => r.id)).toEqual(["near", "far"]);
    expect(ranked[0]!.yearProximity).toBeCloseTo(0.8, 10);
    expect(ranked[1]!.yearProximity).toBeCloseTo(0.4, 10);
  });

  it("reads the UTC year at a year-boundary instant regardless of CI timezone", () => {
    // The ranker uses getUTCFullYear(). This instant is midnight UTC on 1987-01-01, which in any
    // timezone WEST of UTC (e.g. America/*) is still 1986 by LOCAL time. A regression to
    // getFullYear() would read 1986 on such machines -> proximity 0 (2 yrs off, but here we make
    // the story date 1987 so UTC=exact match, local-west=1yr off) and this assertion would fail.
    const boundary = new Date("1987-01-01T00:00:00Z");
    const ranked = rankPhotosForStory(
      { text: "x", occurredDate: "1987-01-01" },
      [{ id: "boundary", caption: null, exifCapturedAt: boundary }],
    );
    // UTC year is 1987 -> exact match -> proximity 1. (Local getFullYear() west of UTC would be
    // 1986 -> proximity 0.9, failing this exact check.)
    expect(ranked[0]!.yearProximity).toBe(1);
  });

  it("computes yearProximity as 0..1 and zeroes beyond the window", () => {
    const candidates: PhotoCandidate[] = [
      { id: "exact", caption: null, exifCapturedAt: yearDate(1980) },
      { id: "edge", caption: null, exifCapturedAt: yearDate(1985) },
      { id: "beyond", caption: null, exifCapturedAt: yearDate(2000) },
    ];
    const ranked = rankPhotosForStory({ text: "x", occurredDate: "1980-01-01" }, candidates);
    const byId = new Map(ranked.map((r) => [r.id, r]));
    expect(byId.get("exact")!.yearProximity).toBe(1);
    expect(byId.get("edge")!.yearProximity).toBeCloseTo(0.5, 10);
    expect(byId.get("beyond")!.yearProximity).toBe(0); // 20 yrs > window -> clamped to 0
    expect(byId.get("beyond")!.score).toBe(0);
    expect(ranked.map((r) => r.id)).toEqual(["exact", "edge", "beyond"]);
  });
});

describe("rankPhotosForStory — purity & token semantics", () => {
  it("does not mutate the input candidates array (order or length)", () => {
    const candidates: PhotoCandidate[] = [
      { id: "low", caption: "unrelated", exifCapturedAt: null },
      { id: "high", caption: "grandpa fishing", exifCapturedAt: null },
      { id: "mid", caption: "grandpa", exifCapturedAt: null },
    ];
    const originalOrder = candidates.map((c) => c.id);
    const ranked = rankPhotosForStory({ text: "grandpa fishing trip", occurredDate: null }, candidates);
    // The result IS reordered...
    expect(ranked.map((r) => r.id)).toEqual(["high", "mid", "low"]);
    // ...but the caller's array is untouched (sort ran on a copy).
    expect(candidates).toHaveLength(originalOrder.length);
    expect(candidates.map((c) => c.id)).toEqual(originalOrder);
  });

  it("counts DISTINCT shared tokens, not occurrences (Set intersection)", () => {
    const ranked = rankPhotosForStory(
      { text: "fishing at the lake", occurredDate: null },
      [{ id: "p", caption: "fishing fishing at the lake", exifCapturedAt: null }],
    );
    // Shared meaningful tokens are {fishing, lake} -> 2, NOT 3 despite "fishing" appearing twice.
    expect(ranked[0]!.captionOverlap).toBe(2);
  });
});

describe("rankPhotosForStory — arm weighting", () => {
  it("a single caption-token match outranks a perfect year match", () => {
    const candidates: PhotoCandidate[] = [
      { id: "perfect-year", caption: null, exifCapturedAt: yearDate(1980) },
      { id: "one-word", caption: "birthday", exifCapturedAt: null },
    ];
    const ranked = rankPhotosForStory(
      { text: "my birthday party", occurredDate: "1980-01-01" },
      candidates,
    );
    // caption weight 1.0 * 1 = 1.0 beats year weight 0.5 * 1 = 0.5
    expect(ranked[0]!.id).toBe("one-word");
    expect(ranked[0]!.score).toBe(PHOTO_RANK_CAPTION_WEIGHT * 1);
    expect(ranked[1]!.score).toBe(PHOTO_RANK_YEAR_WEIGHT * 1);
  });
});

describe("rankPhotosForStory — degradation", () => {
  it("null occurredDate makes the year arm inert (yearProximity null)", () => {
    const ranked = rankPhotosForStory(
      { text: "x", occurredDate: null },
      [{ id: "p", caption: null, exifCapturedAt: yearDate(1980) }],
    );
    expect(ranked[0]!.yearProximity).toBeNull();
    expect(ranked[0]!.score).toBe(0);
  });

  it("preserves input order and scores 0 when nothing matches", () => {
    const candidates: PhotoCandidate[] = [
      { id: "a", caption: null, exifCapturedAt: null },
      { id: "b", caption: "irrelevant", exifCapturedAt: null },
      { id: "c", caption: null, exifCapturedAt: null },
    ];
    const ranked = rankPhotosForStory({ text: "nothing overlaps at all", occurredDate: null }, candidates);
    expect(ranked.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
    expect(ranked).toHaveLength(candidates.length);
  });

  it("handles a mix of null and present exifCapturedAt without crashing", () => {
    const candidates: PhotoCandidate[] = [
      { id: "dated", caption: null, exifCapturedAt: yearDate(1981) },
      { id: "undated", caption: null, exifCapturedAt: null },
    ];
    const ranked = rankPhotosForStory({ text: "x", occurredDate: "1980-01-01" }, candidates);
    const byId = new Map(ranked.map((r) => [r.id, r]));
    expect(byId.get("dated")!.yearProximity).toBeCloseTo(0.9, 10);
    expect(byId.get("undated")!.yearProximity).toBeNull();
  });

  it("never drops a candidate — output length equals input length", () => {
    const candidates: PhotoCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      caption: null,
      exifCapturedAt: null,
    }));
    expect(rankPhotosForStory({ text: "", occurredDate: null }, candidates)).toHaveLength(5);
  });
});

describe("rankPhotosForStory — stable tie-break", () => {
  it("keeps input order for >=3 equal-score candidates", () => {
    const candidates: PhotoCandidate[] = [
      { id: "first", caption: null, exifCapturedAt: null },
      { id: "second", caption: null, exifCapturedAt: null },
      { id: "third", caption: null, exifCapturedAt: null },
      { id: "fourth", caption: null, exifCapturedAt: null },
    ];
    const ranked = rankPhotosForStory({ text: "no signal", occurredDate: null }, candidates);
    expect(ranked.map((r) => r.id)).toEqual(["first", "second", "third", "fourth"]);
  });

  it("keeps input order among equal non-zero scores", () => {
    // Three photos each with exactly one caption-token match -> equal score 1.0.
    const candidates: PhotoCandidate[] = [
      { id: "x1", caption: "cabin", exifCapturedAt: null },
      { id: "x2", caption: "cabin", exifCapturedAt: null },
      { id: "x3", caption: "cabin", exifCapturedAt: null },
    ];
    const ranked = rankPhotosForStory({ text: "the old cabin", occurredDate: null }, candidates);
    expect(ranked.map((r) => r.id)).toEqual(["x1", "x2", "x3"]);
    expect(ranked.every((r) => r.score === 1)).toBe(true);
  });
});

describe("pickPhotoNudge", () => {
  it("returns the top caption-matching candidate", () => {
    const ranked = rankPhotosForStory(
      { text: "grandpa fishing", occurredDate: null },
      [
        { id: "unrelated", caption: "car in driveway", exifCapturedAt: null },
        { id: "match", caption: "grandpa fishing", exifCapturedAt: null },
      ],
    );
    const nudge = pickPhotoNudge(ranked);
    expect(nudge).toEqual({ photoId: "match", caption: "grandpa fishing" });
    expect(ranked[0]!.captionOverlap).toBeGreaterThanOrEqual(PHOTO_NUDGE_MIN_OVERLAP);
  });

  it("returns null when the best is a pure date match (overlap 0)", () => {
    const ranked = rankPhotosForStory(
      { text: "no shared words here", occurredDate: "1980-01-01" },
      [{ id: "perfect-year", caption: null, exifCapturedAt: yearDate(1980) }],
    );
    expect(ranked[0]!.captionOverlap).toBe(0);
    expect(ranked[0]!.score).toBeGreaterThan(0); // it DID score on the year arm
    expect(pickPhotoNudge(ranked)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(pickPhotoNudge([])).toBeNull();
  });
});

describe("rankPhotosForStory — determinism", () => {
  it("produces identical output on repeated calls", () => {
    const signals = { text: "grandpa fishing at the lake in summer", occurredDate: "1980-01-01" };
    const candidates: PhotoCandidate[] = [
      { id: "a", caption: "grandpa at the lake", exifCapturedAt: yearDate(1979) },
      { id: "b", caption: null, exifCapturedAt: yearDate(1985) },
      { id: "c", caption: "unrelated", exifCapturedAt: null },
      { id: "d", caption: "fishing trip", exifCapturedAt: yearDate(2010) },
    ];
    const first = rankPhotosForStory(signals, candidates);
    const second = rankPhotosForStory(signals, candidates);
    expect(second).toEqual(first);
  });

  it("respects the window boundary constant", () => {
    const atWindow: PhotoCandidate[] = [
      { id: "at", caption: null, exifCapturedAt: yearDate(1980 + PHOTO_RANK_YEAR_WINDOW) },
    ];
    const ranked = rankPhotosForStory({ text: "x", occurredDate: "1980-01-01" }, atWindow);
    expect(ranked[0]!.yearProximity).toBe(0); // exactly at window -> 1 - 10/10 = 0
  });
});
