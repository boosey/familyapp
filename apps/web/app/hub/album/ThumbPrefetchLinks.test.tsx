// @vitest-environment jsdom
/**
 * #371 — ThumbPrefetchLinks emits one low-priority image-prefetch hint per album photo id, warming the
 * browser cache so switching to the Album tab paints from cache. The contract this locks:
 *   • one <link rel="prefetch" as="image"> per id, in order;
 *   • the href is the SHARED thumb byte-route URL (`?variant=thumb`) the tiles later request — so the
 *     warmed URL is a byte-for-byte cache hit;
 *   • an empty id list renders nothing (a viewer with no album never emits stray links).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThumbPrefetchLinks } from "./ThumbPrefetchLinks";
import { albumPhotoSrc } from "./photo-src";

function links(ids: string[]): string {
  return renderToStaticMarkup(<ThumbPrefetchLinks ids={ids} />);
}

describe("ThumbPrefetchLinks (#371)", () => {
  it("emits one prefetch/image link per id with the thumb href, in order", () => {
    const html = links(["p1", "p2", "p3"]);
    const matches = html.match(/<link[^>]*>/g) ?? [];
    expect(matches).toHaveLength(3);
    for (const m of matches) {
      expect(m).toContain('rel="prefetch"');
      expect(m).toContain('as="image"');
    }
    // Hrefs are the shared thumb-variant byte route, in id order.
    expect(html.indexOf(albumPhotoSrc("p1", { thumb: true }))).toBeGreaterThan(-1);
    expect(html.indexOf(albumPhotoSrc("p2", { thumb: true }))).toBeGreaterThan(-1);
    expect(html.indexOf(albumPhotoSrc("p1", { thumb: true }))).toBeLessThan(
      html.indexOf(albumPhotoSrc("p3", { thumb: true })),
    );
    // The thumb variant param is present (guards against warming the full-res original).
    expect(html).toContain("variant=thumb");
  });

  it("renders nothing for an empty id list", () => {
    expect(links([])).toBe("");
  });
});
