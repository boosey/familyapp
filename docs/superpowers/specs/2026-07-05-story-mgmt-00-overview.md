# Story Management Affordances — Overview & Build Index

**Date:** 2026-07-05
**Status:** specs written; implementation not started.

## Goal

The single-story read surface (`/hub/stories/[id]`) currently has **no** management
affordances — no delete, no edit, no way to change family tags, no favorite/like.
This feature adds them:

- **Author (owner)** gets full control of their story via a **kebab (⋮) menu** at the
  top-right of the view screen: delete, edit title & tags, manage family sharing, edit
  the prose body.
- **Anyone who can see the story** (author or not) gets **favorite** (private bookmark,
  with an anonymous aggregate count) and **like** (visible thumbs-up reaction), placed
  **directly on the card**, not buried in a menu.

## Design decisions (locked 2026-07-05)

| Decision | Choice |
|---|---|
| Favorite semantics | **Private bookmark.** Only you see your own favorites. Story shows an anonymous aggregate count ("favorited N times") — never *who*. |
| Like semantics | **Visible reaction.** Thumbs-up with a visible count, available to everyone. Distinct from favorite. |
| Who can favorite / like | **Any account viewer** who is authorized to see the story. |
| Who can edit / delete | **Owner only** (delete additionally allows a **family steward** of a targeted family, matching `decideManage`). |
| Editing a shared/consented story's prose or title | **Free, no re-consent.** Consent governs *who it is shared with*, not a freeze on the author's own words. Every edit appends a `prose_revisions` audit row for provenance. |
| Non-author editing tags | **No.** Tags are the author's descriptive metadata; owner-only. |

## Why split into many specs

The user may run out of session budget mid-build. Each unit below is an **independently
grabbable, resumable vertical slice** with its own spec + plan in one self-contained file.
Finishing any one leaves the app shippable. The only shared dependency is **Unit 01 (the
shell)**; every later unit carries a short "if the shell doesn't exist yet" fallback so it
is never truly blocked.

## Build order (recommended, but each is independent)

| # | Unit | File | Migration? | Core work |
|---|---|---|---|---|
| 01 | Action shell & shared contracts | `...-01-action-shell.md` | no | `OwnerActionMenu`, `isOwner`, server-action convention |
| 02 | Delete story | `...-02-delete.md` | no | wire existing `eraseStory` to UI |
| 03 | Edit title & tags | `...-03-edit-details.md` | no | new owner-gated `editStoryDetails` core fn |
| 04 | Manage family sharing | `...-04-manage-sharing.md` | no | owner gate over existing `setStoryFamilyTargets` |
| 05 | Edit story prose (post-share) | `...-05-edit-prose.md` | no | new owner-gated `editStoryProse` core fn |
| 06 | Favorite (private bookmark + count) | `...-06-favorite.md` | **yes** | `story_favorites` table + toggle/count fns + heart UI |
| 07 | Like (visible reaction) | `...-07-like.md` | **yes** | `story_likes` table + toggle/count fns + thumbs UI |

## Shared codebase facts (verified 2026-07-05)

- **Read surface:** `apps/web/app/hub/stories/[id]/page.tsx` (`StoryDetailPage`, server
  component). Reads via the single front door: `getStoryForViewer(db, ctx, id)`. Already
  has `ctx.kind`/`ctx.personId` in scope (used for `markStorySeen`). No action area today.
- **Single front door:** all Story/Media **reads** go through
  `packages/core/src/authorization.ts`; all content **writes** through
  `packages/core/src/story-repository.ts`; hard deletes through
  `packages/core/src/erasure-repository.ts`.
- **Architecture allowlist** (`packages/core/test/architecture.test.ts`): the only files
  allowed to touch `stories`/`media` are `authorization.ts`, `story-repository.ts`,
  `intake-answer-repository.ts`, `album-repository.ts`, `story-image-repository.ts`,
  `erasure-repository.ts`. **New mutations must live in one of these** (favorite/like/edit
  → `story-repository.ts`), or the allowlist must be edited deliberately with a canary
  update.
- **Server-action pattern** (mirror `apps/web/app/hub/answer/[askId]/actions.ts`):
  `"use server"`; re-read `getRuntime()` + `getCurrentAuthContext()` on the server; never
  trust a client-supplied `personId`.
- **Erasure already built:** `eraseStory(db, ctx, {storyId})` in `erasure-repository.ts` —
  hard delete, owner-or-steward via `decideManage`, cascade + `erasure_audit` row, returns
  `{allowed, storageKeys}`. Not wired to any UI yet.
- **Family targeting already built:** `setStoryFamilyTargets(db, storyId, familyIds)` in
  `story-repository.ts` (REPLACE-SET; validates targets are owner's active families; takes
  **no** AuthContext — caller must authorize). `FamilyPicker` at
  `apps/web/app/hub/FamilyPicker.tsx`. Viewer families via `loadViewerFamilies` /
  intersection via `loadStoryFamilyTargets` in `apps/web/lib/hub-data.ts`.
- **DB evolution:** edit `packages/db/src/schema.ts` → `pnpm --filter @chronicle/db
  db:generate` emits BOTH the snapshot (`drizzle/schema.sql` + `invariants.sql`) and a new
  incremental migration (`drizzle/migrations/NNNN_*.sql`). Trigger/invariant changes must
  be hand-carried into the emitted migration. Drift-guard test bonds the two. Tests use
  PGlite (real Postgres in-process) — no external DB to provision.

## Cross-unit consistency notes (read before building any unit)

- **Migration numbering is order-dependent.** The last migration on `master` is `0003`
  (`ask_families`). Units 06 (favorite) and 07 (like) each add one migration. **Whichever
  you build first takes `0004`; the second takes `0005`.** Do not hard-code the number from
  the spec — run `pnpm --filter @chronicle/db db:generate` and use whatever it emits. The
  like spec (07) text says `0004` illustratively; treat it as "the next free number."
- **Two core-signature shapes coexist, on purpose:**
  - Owner-gated edits (units 03 `editStoryDetails`, 05 `editStoryProse`) follow the existing
    `story-repository` write idiom `(db, { storyId, actorPersonId, … })` and assert
    `actorPersonId === story.ownerPersonId` internally.
  - See-authorized actions (units 04 retarget, 06 favorite, 07 like) take
    `(db, ctx, { … })` because they must call the read front door
    (`getStoryForViewer`/`decideStoryRead`) to prove the actor may see the story.
  When implementing, the server action always re-derives auth server-side and passes the
  correct actor identity down; do not thread `personId` from the client.
- **Erase cascade:** units 06 and 07 add per-viewer rows (`story_favorites`, `story_likes`).
  Each is specced with `ON DELETE CASCADE`, but confirm `eraseStory` in
  `erasure-repository.ts` still passes its tests after the FK is added (the cascade order is
  load-bearing). The favorite/like specs note this — honor it.

## Status checklist (update as units land)

- [ ] 01 Action shell
- [ ] 02 Delete
- [ ] 03 Edit title & tags
- [ ] 04 Manage sharing
- [ ] 05 Edit prose
- [ ] 06 Favorite
- [ ] 07 Like
