/**
 * Windowed-tile CSS containment (#219). We do NOT recycle DOM nodes (react-window) — that would break
 * masonry, scroll restoration, and the lightbox, and cannot window the album's default multi-column
 * masonry view. Instead each UNIFORM (square) photo tile opts into `content-visibility: auto`, so the
 * browser skips layout + paint for off-screen tiles while leaving every node in the DOM (client-side
 * facet filtering therefore stays correct — only what is PAINTED changes, not what is LOADED).
 *
 * `contain-intrinsic-size` supplies a placeholder height for the skipped tiles so the scrollbar / scroll
 * position stay stable as tiles paint in. It is only a hint; an approximate square (the tile width) is
 * fine. Applied ONLY to uniform CSS-grid surfaces — masonry (CSS multi-column) and the list (table)
 * layouts, where `contain` is unreliable, get `loading="lazy"` on their images alone. See
 * `docs/superpowers/specs/2026-07-23-album-grid-virtualization-design.md`.
 *
 * Client-safe (pure style values, no server-only deps): imported by client components to style tiles.
 */
import type { CSSProperties } from "react";

/** Default intrinsic-size hint (px) for a windowed square photo tile — used when a surface has no
 *  natural per-tile size to pass (e.g. an uncontrolled album grid at its default thumb). */
export const DEFAULT_TILE_INTRINSIC_PX = 220;

/**
 * `content-visibility` containment for a uniform (roughly square) photo tile. `intrinsicPx` is the
 * `contain-intrinsic-size` placeholder height so an off-screen (unpainted) tile still reserves space —
 * no scroll jump. Spread onto the tile's container element (the `<li>`).
 */
export function tileContainment(intrinsicPx: number = DEFAULT_TILE_INTRINSIC_PX): CSSProperties {
  return {
    contentVisibility: "auto",
    containIntrinsicSize: `auto ${intrinsicPx}px`,
  };
}
