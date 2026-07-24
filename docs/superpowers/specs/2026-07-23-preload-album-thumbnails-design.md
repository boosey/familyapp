# Preload album thumbnails (#371) — design

**Issue:** #371 — "Preload album thumbnails."
> Greedily fetch thumbnails for album on:
> 1. Hub load so when user switches to album they are loaded.
> 2. Always load the next scroll-to area (assuming the album is infinite scroll).

**Branch:** `feat/preload-album-thumbs-371`

## Context & the tension with #219

#219 (PR #366, merged) deliberately made album thumbnails **lazy** — every tile uses
`<img loading="lazy">`, and uniform grid tiles additionally opt into `content-visibility: auto`
(`tile-containment.ts`). The explicit goal was to *avoid* fetching/decoding ~500 thumbnails at once
(the album is defensively capped at `ALBUM_PHOTO_QUERY_CAP`, not paginated — **all** tiles are in the
DOM at once; only *painting* is windowed, there is no infinite scroll).

Issue #371 asks for the opposite instinct — greedily preload. The reconciliation that does **not**
undo #219: warm the browser's HTTP/image cache **ahead** of the lazy loader, at low priority, using
`<link rel="prefetch" as="image">`. Tiles stay `loading="lazy"`; when a lazy `<img>` later requests a
URL already in the prefetch cache, it resolves instantly. Warming is purely additive — it never
changes what the tiles render, so #219 cannot regress.

### Scope decision (owner, 2026-07-23)

The issue names two points. Point #2 ("always load the next scroll-to area") is **dropped**:
`loading="lazy"` already loads tiles as they approach the viewport, so a bespoke scroll-ahead
IntersectionObserver would only add a larger, guaranteed lookahead margin — marginal value for real
complexity. **Only point #1 is built.** If scrolling ever feels laggy in practice, revisit a
controlled lookahead as a separate ticket.

## The gap point #1 addresses

`AlbumSurface` is server-rendered **only** when `?tab=album` (`hub/page.tsx` gates
`activeTab === "album"`). On a normal hub load (default Stories tab) the album's photo IDs are never
even fetched — so there is nothing on the page to warm. Point #1 requires getting the first
screenful of album thumbnail IDs onto **every** hub render, regardless of the active tab, and emitting
prefetch hints for them.

## Design — cross-tab warm on hub load

Entirely server-rendered; **zero client JS**.

### 1. Core read: `listAlbumPhotoIds`

New export in `packages/core/src/album-repository.ts`:

```ts
export async function listAlbumPhotoIds(
  db: Database,
  ctx: AuthContext,
  familyIds: string[],
  opts?: { limit?: number },
): Promise<string[]>
```

- Mirrors `listAlbumPhotosDetailed`'s membership gating: viewer must hold an ACTIVE membership in a
  family to see its photos; unauthorized/unknown `familyIds` are silently dropped; anonymous ⇒ `[]`.
- Returns **only** photo ids (`string[]`), deduped, most-recent first (`createdAt` desc, `id` desc),
  excluding soft-deleted rows, capped at `opts.limit` (default `ALBUM_PHOTO_QUERY_CAP`).
- **One** SQL query (`SELECT DISTINCT id … JOIN placements … WHERE family IN (…) AND deletedAt IS NULL
  ORDER BY createdAt DESC, id DESC LIMIT n`) — deliberately cheaper than the 7-query detailed read,
  because warming needs nothing but the ids. This makes it safe to run on every hub load.
- Added to the architecture allowlist only if it needs raw table access already available in this file
  (it lives in `album-repository.ts`, already an allowlisted content-read surface).

### 2. Hub page wiring (`apps/web/app/hub/page.tsx`)

- Compute the shown family ids the same way `AlbumSurface` does (`parseFamilyFilter` + `selectedIdList`
  against `activeFamilies`) — so the warmed set matches what the Album tab will actually show under the
  current `?families=` filter.
- Call `listAlbumPhotoIds(db, ctx, shownFamilyIds, { limit: ALBUM_WARM_FIRST_SCREEN })` inside the
  existing `Promise.all` (one extra cheap query; negligible next to the ~10 reads already there).
- Render `<ThumbPrefetchLinks ids={warmIds} />` in the hub shell (near the tab content) on **every**
  tab, so the first screenful is warming while the user is on Stories/Family/Questions.

### 3. `<ThumbPrefetchLinks>` helper

New tiny **server** component (no `"use client"`), e.g. `apps/web/app/hub/album/ThumbPrefetchLinks.tsx`:

```tsx
export function ThumbPrefetchLinks({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id) => (
        <link key={id} rel="prefetch" as="image" href={albumPhotoSrc(id, { thumb: true })} />
      ))}
    </>
  );
}
```

- Uses the existing `albumPhotoSrc(id, { thumb: true })` builder (single source for the byte-route URL)
  — so warmed URLs are byte-identical to what the tiles later request → guaranteed cache hits.
- `rel="prefetch"` (not `preload`): lowest priority, meant for "probably needed soon," and — unlike
  `preload` — emits **no** "resource was preloaded but not used" console warning when the viewer never
  opens the Album tab. Cookies are sent (same-origin), so `/api/album-photo/[id]?variant=thumb`'s
  per-request auth gate still applies to every warmed byte.
- React 19 hoists `<link>` into `<head>`; even if rendered in body, browsers honor `rel=prefetch`
  links there.

### Why not `preload`/`fetchpriority=low`

`preload` fetches immediately at (lowered) priority but logs an "unused preload" warning and wastes
bandwidth when the Album tab is never opened — common, since it's warmed on *every* hub load. `prefetch`
is the correct "might-need-soon, no-penalty-if-unused" primitive here.

## Externalized constants

Per repo convention (JS-used numbers → TS constant, single source):

- `ALBUM_WARM_FIRST_SCREEN = 24` — how many thumbnails to warm on hub load. New file
  `apps/web/app/hub/album/prefetch-constants.ts` (or appended to an existing album constants module).
  Chosen as ~one screenful at the default thumb size; a plain safety bound, not tuned.

## Testing

- **Core** (`packages/core/test/album-repository*.test.ts`, PGlite): `listAlbumPhotoIds` returns only
  ids, deduped, most-recent-first, respects active-membership gating (non-member ⇒ `[]`), drops
  unauthorized family ids, excludes soft-deleted rows, and honors `limit`.
- **Hub render**: the hub page renders exactly `min(count, ALBUM_WARM_FIRST_SCREEN)` prefetch links
  with `rel="prefetch"`, `as="image"`, and thumb-variant hrefs, for a viewer with an album; **zero**
  links for a viewer with no album photos / no family.
- **Regression companion** (if a bug is found during build): per repo rule, add a targeted test.

## Non-goals

- Scroll-ahead prefetch within the album (issue point #2) — dropped, see scope decision.
- Any change to tile rendering, `loading="lazy"`, or `content-visibility` (#219 stays intact).
- Pagination / infinite scroll (the album remains all-in-DOM, defensively capped).
