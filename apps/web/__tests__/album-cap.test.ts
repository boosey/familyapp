/**
 * `apps/web/lib/album-cap.ts` — the #217 defensive-cap helpers the loop-all-families photo pickers
 * use to bound their deduped union (the album grid caps in-core; the pickers cap the union here).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALBUM_PHOTO_QUERY_CAP } from "@chronicle/core";
import { capAlbumUnion, warnAlbumCapHit } from "@/lib/album-cap";

/** A row shaped like the pickers' collected candidates: an id + a createdAt to rank by. */
const row = (id: string, ms: number) => ({ id, createdAt: new Date(ms) });

describe("capAlbumUnion", () => {
  it("is a no-op at/under the cap, preserving input order untouched", () => {
    const input = [row("a", 3000), row("b", 1000), row("c", 2000)]; // deliberately NOT recency order
    const { rows, capped } = capAlbumUnion(input, 3);
    expect(capped).toBe(false);
    // Same order as given — no sort applied when within the cap.
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    // A copy, not the same reference (callers may mutate).
    expect(rows).not.toBe(input);
  });

  it("keeps the most-recent `cap` rows when the union overflows", () => {
    const input = [row("old", 1000), row("new", 3000), row("mid", 2000), row("older", 500)];
    const { rows, capped } = capAlbumUnion(input, 2);
    expect(capped).toBe(true);
    expect(rows.map((r) => r.id)).toEqual(["new", "mid"]);
  });

  it("treats exactly-cap as within bounds (not capped)", () => {
    const { capped } = capAlbumUnion([row("a", 1), row("b", 2)], 2);
    expect(capped).toBe(false);
  });

  it("defaults the cap to ALBUM_PHOTO_QUERY_CAP", () => {
    // One row over the real ceiling → capped; the exact ceiling is asserted elsewhere, here we only
    // pin that the default IS that ceiling (no local magic number).
    const input = Array.from({ length: ALBUM_PHOTO_QUERY_CAP + 1 }, (_, i) => row(`p${i}`, i));
    expect(capAlbumUnion(input).capped).toBe(true);
    expect(capAlbumUnion(input).rows).toHaveLength(ALBUM_PHOTO_QUERY_CAP);
    expect(capAlbumUnion(input.slice(0, ALBUM_PHOTO_QUERY_CAP)).capped).toBe(false);
  });
});

describe("warnAlbumCapHit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits one greppable console.warn breadcrumb", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnAlbumCapHit("ask-photo-picker", 500, 742);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0]![0] as string;
    expect(line).toContain("[album:cap]");
    expect(line).toContain("surface=ask-photo-picker");
    expect(line).toContain("cap=500");
    expect(line).toContain("loaded=742");
  });
});
