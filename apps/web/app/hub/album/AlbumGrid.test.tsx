// @vitest-environment jsdom
/**
 * #219 — the album grid windows off-screen tiles via CSS containment (NOT DOM recycling). The contract
 * this locks (jsdom has no layout engine, so we assert the affordance, not the pixels):
 *   • every real photo tile <img> carries loading="lazy" (defers fetch/decode) — in BOTH layouts;
 *   • uniform GRID tiles opt into content-visibility:auto (skip off-screen layout + paint);
 *   • MASONRY tiles do NOT — content-visibility is unreliable inside CSS multi-column, so they
 *     intentionally get loading="lazy" alone. The negative assertion documents that tiering.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AlbumGrid, type AlbumGridPhoto } from "./AlbumGrid";

// The grid calls useRouter() (delete/bulk navigation); no real navigation happens in these renders.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

const PHOTOS: AlbumGridPhoto[] = [
  { id: "p1", caption: "First", canManage: true },
  { id: "p2", caption: null, canManage: false },
  { id: "p3", caption: "Third", canManage: true },
];

describe("AlbumGrid windowing (#219)", () => {
  it("grid view: every tile img is lazy and every grid tile opts into content-visibility", () => {
    const { container } = render(<AlbumGrid photos={PHOTOS} view="grid" thumbPx={200} />);

    const grid = container.querySelector('ul[data-view="grid"]');
    expect(grid).not.toBeNull();

    const imgs = grid!.querySelectorAll("img");
    expect(imgs).toHaveLength(PHOTOS.length);
    for (const img of imgs) expect(img.getAttribute("loading")).toBe("lazy");

    const tiles = grid!.querySelectorAll(":scope > li");
    expect(tiles).toHaveLength(PHOTOS.length);
    for (const tile of tiles) {
      expect((tile as HTMLElement).style.contentVisibility).toBe("auto");
      expect((tile as HTMLElement).style.containIntrinsicSize).toBe("auto 200px");
    }
  });

  it("masonry view: tile imgs are lazy but tiles do NOT set content-visibility (multi-column tier)", () => {
    const { container } = render(<AlbumGrid photos={PHOTOS} view="masonry" thumbPx={200} />);

    const grid = container.querySelector('ul[data-view="masonry"]');
    expect(grid).not.toBeNull();

    const imgs = grid!.querySelectorAll("img");
    expect(imgs).toHaveLength(PHOTOS.length);
    for (const img of imgs) expect(img.getAttribute("loading")).toBe("lazy");

    const tiles = grid!.querySelectorAll(":scope > li");
    for (const tile of tiles) {
      expect((tile as HTMLElement).style.contentVisibility).toBe("");
    }
  });
});
