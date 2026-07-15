# Tree changes — Slice B: contribution destinations

**Date:** 2026-07-14
**Status:** Design — approved decisions folded in
**Depends on:** Slice A (the details sheet + kebab exist and reserve these link/menu slots).
**Surface:** new `apps/web/app/hub/person/[personId]/*`, `packages/core` read queries,
`apps/web/app/hub/tree/*` (wire links live).

## Goal

Give the three contribution kebab/details-sheet entries real destinations (`#2` first three):

- **Stories contributed** — stories this person **narrated / owns** (`stories.ownerPersonId`).
- **Photos contributed** — photos this person contributed (`family_photos.contributorPersonId`).
- **Mentions** — stories this person is **about** (`story_subjects`), which already has a live view
  at `/hub/about/[personId]` (`listStoriesAboutPerson`).

## Decision: one person page with tabs

A single **`/hub/person/[personId]`** page with three sections/tabs: **Stories · Photos · Mentions**.
Deep-linkable via `?section=stories|photos|mentions` (default `stories`). The Slice-A details-sheet
links and the kebab items point here with the right `?section=`. The existing `/hub/about/[personId]`
content folds in as the **Mentions** tab (redirect the old route or keep it as a thin alias).

Rationale: avoids three near-identical routes and three near-identical loaders; one authorization
site; one place Slice A's disabled links become live.

## Front-door discipline (load-bearing)

All three reads are **content reads** and MUST go through `@chronicle/core` — no raw table access
outside the allowlist (`packages/core/test/architecture.test.ts`). Each query **narrows via an
authorized predicate; it never grants** (mirrors `listStoriesAboutPerson`): the viewer sees only the
subset they were already entitled to, filtered to this person's contributions.

## Core queries (new, in `story-repository.ts` / `album-repository.ts`)

1. `listStoriesNarratedByPerson(db, ctx, personId): Promise<StoryCard[]>`
   - Stories where `ownerPersonId === personId`, intersected with the viewer's authorized visibility
     (same predicate machinery `listStoriesAboutPerson` uses). Returns lightweight cards
     (id, title, dates, target families) — no prose bytes.
   - Add `story-repository.ts` to the architecture allowlist entry only if a new content path is
     introduced; reuse the existing authorized read surface if possible.
2. `countStoriesNarratedByPerson` / `countStoriesAboutPerson` — cheap counts for the kebab/sheet
   badges (optional; may be derived from the list length in v1 to avoid extra queries).
3. `listPhotosContributedByPerson(db, ctx, personId): Promise<AlbumPhotoCard[]>`
   - Photos where `contributorPersonId === personId`, gated by the album read authorization
     (`assertPersonCanAccessAlbumPhoto` generalized to a list predicate). Returns thumbnails/metadata
     only; media bytes stay behind the storage seam.

Counts shown in the details sheet / kebab labels are best-effort and authorized-scoped (a viewer sees
"3 stories" only counting the ones they may see).

## Page (`/hub/person/[personId]`)

- Server component: resolve `ctx`, validate the person is visible to the viewer (reuse the tree/kin
  visibility gate), load the active section's list. Render a tabbed client shell (mirrors the
  Album/Stories tab pattern already in the hub).
- **Stories** tab → cards linking to `/hub/stories/[id]`.
- **Photos** tab → the album card/grid components, filtered to this contributor.
- **Mentions** tab → the existing `/hub/about/[personId]` list, moved in.
- Empty states per tab ("No stories contributed yet", etc. — new copy).

## Wire Slice A's links live

- Details sheet (`person-details.tsx`): the three links, previously disabled for Stories/Photos, now
  point at `/hub/person/[id]?section=…`. Remove the "coming soon" affordance.
- `kebab-menu.tsx`: add **Stories contributed · Photos contributed · Mentions** items *before*
  `Focus` (final order: `[Stories · Photos · Mentions · Focus] — [Add …]`).

## Files touched

- `packages/core/src/story-repository.ts` — `listStoriesNarratedByPerson` (+ maybe count).
- `packages/core/src/album-repository.ts` — `listPhotosContributedByPerson` (+ maybe count).
- `packages/core/src/index.ts` — re-exports.
- `packages/core/test/architecture.test.ts` — allowlist only if a genuinely new content path is added.
- `apps/web/app/hub/person/[personId]/page.tsx` + a client tab shell — **new**.
- `apps/web/app/hub/about/[personId]/page.tsx` — fold into the Mentions tab / alias.
- `apps/web/app/hub/tree/person-details.tsx`, `kebab-menu.tsx` — wire links + add three items.
- `apps/web/app/_copy/hub.ts` — person-page copy, kebab labels, empty states.

## Testing

- Core: narrated-by / contributed-by queries return only authorized rows (seed a cross-family story
  the viewer may NOT see; assert it is excluded). Regression: the "narrows, never grants" property.
- Page: each tab renders its list; `?section=` deep-links; empty states.
- Front-door: `architecture.test.ts` stays green (no bypass).
