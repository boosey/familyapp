# Album + photo pickers: windowed rendering (#219) — design

Follow-up to #217 (part **c**). The defensive `LIMIT` (`ALBUM_PHOTO_QUERY_CAP = 500`) shipped in
#224; the album grid and the two photo pickers still **mount and eagerly load every capped tile at
once** — at the cap that is up to ~500 `<img>` tiles fetching, decoding, laying out, and painting
simultaneously.

## Decision: CSS containment, not DOM recycling

The issue text suggests `react-window`-style DOM recycling. We deliberately **do not** take that path.
Recycling would break the three things the issue itself flags as watch-outs — scroll restoration, the
lightbox (open-from-tile), and lazy image loading — and it cannot window the album's **default masonry
view** (CSS multi-column, per-image natural aspect ratios; no fixed cell size to recycle).

Instead we let the browser skip the work for off-screen tiles while leaving every node in the DOM:

- **`loading="lazy"`** on every real photo tile `<img>` — defers the *dominant* cost (the image
  fetch + decode) until the tile nears the viewport. Universal and layout-agnostic; safe everywhere.
- **`content-visibility: auto` + `contain-intrinsic-size`** on the tile container — the browser skips
  layout + paint for off-screen tiles, using the intrinsic size as a placeholder so the scrollbar and
  scroll position stay stable.

Nodes stay in the DOM, so the full list is still in memory: **client-side facet filtering stays
correct** (only what is *painted* changes, not what is *loaded* or *filtered*), and scroll
restoration, the lightbox, and long-press selection are all untouched.

## Safety tiering

`content-visibility: auto` is unreliable inside **CSS multi-column** (masonry must measure children to
balance columns) and inside **table layout** (`contain` fights the table algorithm). Those surfaces get
`loading="lazy"` only — which already recovers the dominant cost. The uniform CSS-grid surfaces get
both.

| Surface | Layout | `loading="lazy"` | `content-visibility` |
|---|---|:---:|:---:|
| `AlbumGrid` — grid view (`AlbumTile`, non-masonry) | CSS grid, uniform | ✅ | ✅ |
| `AlbumGrid` — masonry view (`AlbumTile masonry`) | CSS multi-column | ✅ | ❌ |
| `AlbumListView` — list view rows | `<table>` | ✅ | ❌ |
| `AskPhotoPicker` — modal picker grid | CSS grid, uniform | ✅ | ✅ |
| `StoryPhotosEditor` — album-picker grid | CSS grid, uniform | ✅ | ✅ |

## `contain-intrinsic-size`

Each windowed (content-visibility) tile gets an intrinsic-size placeholder so painting a tile in does
not shift layout. The size is naturally **per-surface**, not one shared magic number:

- `AlbumGrid` grid tile: slider-driven `thumbPx` (the tile is ~1:1, so `auto <thumbPx>px` is a good
  placeholder; exact is unnecessary — it is only a hint).
- `AskPhotoPicker`: its own fixed grid min (`110px`).
- `StoryPhotosEditor` picker: its own fixed grid min (`120px`).

## Shared helper (centralization convention)

The containment technique is repeated across the inline-style surfaces. A tiny **client-safe** helper
centralizes it:

`apps/web/app/hub/album/tile-containment.ts`
```ts
/** Default intrinsic-size hint (px) for a windowed square photo tile. */
export const DEFAULT_TILE_INTRINSIC_PX = 220;

/** content-visibility containment for a uniform (square) photo tile. `intrinsicPx` is the
 *  contain-intrinsic-size placeholder height so off-screen tiles reserve space (no scroll jump). */
export function tileContainment(intrinsicPx?: number): React.CSSProperties {
  return {
    contentVisibility: "auto",
    containIntrinsicSize: `auto ${intrinsicPx ?? DEFAULT_TILE_INTRINSIC_PX}px`,
  };
}
```

Consumers:
- `AlbumGrid` grid `<li>` (`AlbumTile`, non-masonry only) — spread `tileContainment(thumbPx)` into the
  `<li>` style.
- `StoryPhotosEditor` album-picker `<li>` — spread `tileContainment(120)`.
- `AskPhotoPicker` uses **CSS Modules**, so the two properties are added to `.grid li` in
  `AskPhotoPicker.module.css` directly (matching that component's styling idiom; the `110px` there
  already lives locally in that file next to `minmax(110px, …)`).

## Scope

**In scope:** the five surface rows above. `loading="lazy"` on their real photo tile `<img>`;
`content-visibility` on the three uniform-grid rows via the helper / module CSS.

**Out of scope (deliberately eager / untouched):**
- Pending-import placeholder tiles (`PendingImportTile` / `MasonryPendingTile`) — few, top-of-list,
  the user is actively watching them fill in.
- The closed-form selection-readout thumbnails and the caption nudge thumbnail — not grids, tiny.
- `StoryPhotosEditor`'s *attached* images strip — a handful per story, not a 500-scale surface.
  (`loading="lazy"` may be added harmlessly for consistency but is not required.)

## Testing

jsdom has no layout engine, so we test the **contract, not the pixels**:

- `AlbumGrid` (pure-prop, easiest): render grid view with N photos → every real tile `<img>` has
  `loading="lazy"` and every grid `<li>` carries `content-visibility: auto`. Render masonry view →
  tile `<img>`s have `loading="lazy"` (and, as the negative assertion, masonry `<li>`s do **not** set
  `content-visibility`, documenting the intentional tiering).
- `tile-containment.ts` unit test: `tileContainment(n)` returns the expected `contentVisibility` /
  `containIntrinsicSize`, and the default when called bare.

Real perf + interaction validation is **manual** (the issue's watch-out): scroll the album at ~500
tiles in the browser and confirm masonry layout, scroll restoration, the lightbox (open-from-tile),
and long-press selection all still behave.

## Files touched

- `apps/web/app/hub/album/tile-containment.ts` — **new** helper + constant.
- `apps/web/app/hub/album/AlbumGrid.tsx` — `loading="lazy"` on the `AlbumTile` `<img>`;
  `tileContainment(thumbPx)` on the grid (non-masonry) `<li>`.
- `apps/web/app/hub/album/AlbumListView.tsx` — `loading="lazy"` on the row thumbnail `<img>`.
- `apps/web/app/hub/tabs/AskPhotoPicker.tsx` — `loading="lazy"` on the modal tile `<img>`.
- `apps/web/app/hub/tabs/AskPhotoPicker.module.css` — `content-visibility` + `contain-intrinsic-size`
  on `.grid li`.
- `apps/web/app/hub/StoryPhotosEditor.tsx` — `loading="lazy"` on the picker `<img>`;
  `tileContainment(120)` on the picker `<li>`.
- Tests: `apps/web/app/hub/album/AlbumGrid.test.tsx` (new) and
  `apps/web/app/hub/album/tile-containment.test.ts` (new).
