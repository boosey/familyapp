# Unit 06 — Favorite (private bookmark + anonymous count)

**Prerequisite:** none hard. Loosely related to Unit 01 (the card action row) — see "UI placement".
**Migration:** YES (new `story_favorites` table → new incremental migration, applies to prod Neon at deploy).
**Blast radius:** one new open-schema table + migration; three new audited functions in `story-repository.ts` + one `index.ts` export; the story detail page action row + one new client component + a colocated `actions.ts`.

## Purpose

Let any authorized viewer privately bookmark a story ("favorite" it) and see an **anonymous**
aggregate count of how many people have favorited it. A favorite is a *private bookmark*: only
you see your own favorites, and nobody — not even the owner — ever sees *who* favorited a story,
only the number. This is deliberately distinct from Unit 07 "like" (a *visible* reaction that
attributes a person). Greenfield: no favorite concept exists anywhere today.

## Spec

### Semantics (LOCKED — do not contradict)

- A favorite is a **private bookmark**. Only the favoriting viewer sees their own favorites.
- The story surfaces an **anonymous aggregate count** ("favorited N times") — never a list of
  who. The read path structurally cannot return person ids to the client (see "anonymity
  guarantee").
- Available to **any account viewer authorized to SEE the story** (owner or not). Favoriting
  requires **SEE permission, not ownership** — you can favorite a family member's story, and the
  owner can favorite their own.
- Idempotent: favoriting a story you already favorited is a no-op; a person has at most one
  favorite per story. Toggling off removes the row.
- Distinct from "like" (Unit 07). Do not conflate the two tables or buttons.

### New table — `story_favorites` (open schema, NOT behind `/content`)

A favorite is **per-viewer state**, not Story content (it exposes nothing about the story's
words) — exactly like the existing `story_views` table. So the table object lives in the OPEN
schema (`@chronicle/db/schema`, freely importable); it is NOT added behind the `/content` guard
and does NOT touch the architecture allowlist for content-table imports.

Add to `packages/db/src/schema.ts`, modeled on `storyViews` (schema.ts ~919-939):

```ts
export const storyFavorites = pgTable(
  "story_favorites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The story that was favorited. FK to stories with ON DELETE CASCADE (see cascade decision). */
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    /** The account-person who favorited it (their PRIVATE bookmark). */
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One favorite per (story, person) — makes the toggle idempotent and the count a plain COUNT(*).
    uniqueIndex("story_favorites_story_person_uq").on(t.storyId, t.personId),
    index("story_favorites_person_idx").on(t.personId),
  ],
);

export type StoryFavorite = typeof storyFavorites.$inferSelect;
export type NewStoryFavorite = typeof storyFavorites.$inferInsert;
```

The `(story_id, person_id)` UNIQUE index is the load-bearing constraint: it makes favoriting
idempotent (upsert / `onConflictDoNothing`), toggling clean (delete by the pair), and the count a
simple `COUNT(*)` over `story_id`.

### Migration steps (per `CLAUDE.md` § Commands)

1. Edit `packages/db/src/schema.ts` (add `storyFavorites` + inferred types above).
2. Run `pnpm --filter @chronicle/db db:generate`. This emits BOTH the snapshot
   (`drizzle/schema.sql` + `drizzle/invariants.sql`) AND a new incremental migration
   `drizzle/migrations/NNNN_*.sql` for the modeled diff. The new table is a plain additive CREATE
   TABLE — no invariant/trigger to hand-carry (favorites are not append-only, not content).
3. The migration applies to prod Neon at deploy via `db:migrate` in the Vercel build. Tests use
   PGlite (in-process Postgres) via the fast snapshot path — no external DB to provision.
4. The drift-guard test (`packages/db/test/migration-drift.test.ts`) bonds snapshot & migration
   chain; it must stay green after `db:generate`.

### Cascade decision (favorites on erasure)

**Choice: FK `ON DELETE CASCADE` on `story_favorites.story_id → stories.id`.** No change to
`eraseStory` is required.

Rationale: `eraseStory` (erasure-repository.ts ~107-198) deletes children explicitly and then
`tx.delete(stories)`. With `onDelete: "cascade"` on the favorites FK, Postgres removes the favorite
rows automatically when the story row is deleted, so `eraseStory` needs no new `tx.delete`. Same for
`discardDraftStory` (story-repository.ts) — an owner can favorite their own draft, then discard it;
the story-row delete cascades the favorite away. This mirrors the cascade precedent already used by
`voice_captions`, `intake_revisions`, and `family_photo_families`.

> Adversarial note carried into "Adversarial notes": the sibling `story_views` table uses a plain
> (no-cascade) FK to `stories.id` and is NOT deleted by `eraseStory` — a latent gap. We deliberately
> do NOT copy that pattern; favorites use CASCADE so erase can never FK-violate on a favorited story.
> A regression test (erase a favorited story) proves it.

### Core functions (in `story-repository.ts` — on the allowlist; do NOT add a new file)

All three live in `packages/core/src/story-repository.ts` and are re-exported from
`packages/core/src/index.ts`. They import `storyFavorites` from `@chronicle/db/schema` (open) and
reuse the front door (`getStoryForViewer` / `decideStoryRead` from `./authorization`) for the
SEE-not-own gate.

```ts
export interface FavoriteState {
  /** Whether THIS viewer has favorited the story. Always false for a non-account viewer. */
  favoritedByViewer: boolean;
  /** Anonymous aggregate — COUNT(*) of favorites. Never a list of who. */
  count: number;
}

/** Toggle the viewer's private favorite. Requires SEE permission (not ownership). */
export async function setStoryFavorite(
  db: Database,
  ctx: AuthContext,
  input: { storyId: string; favorited: boolean },
): Promise<FavoriteState>;

/** The viewer's own flag + the anonymous count. Requires SEE permission. */
export async function getFavoriteState(
  db: Database,
  ctx: AuthContext,
  storyId: string,
): Promise<FavoriteState>;

/** Follow-up seam (see below) — the viewer's own favorited stories, most recent first. */
export async function listFavoriteStoriesForViewer(
  db: Database,
  ctx: AuthContext,
): Promise<string[]>; // story ids
```

**`setStoryFavorite`** behavior:
1. Require an account viewer: `ctx.kind === "account"` (a favorite is a browsing-account action).
   Reject `anonymous` and `link_session` (the capture identity has no browsing bookmark) with an
   `InvariantViolation` — the UI hides the toggle for these, so this is defense-in-depth.
2. **Authorize SEE via the front door**: `const story = await getStoryForViewer(db, ctx, storyId)`;
   if `null`, the viewer cannot see it → throw `InvariantViolation` (you cannot favorite what you
   cannot see). This is the load-bearing check.
3. If `favorited`: `INSERT ... ON CONFLICT (story_id, person_id) DO NOTHING` (idempotent).
   If `!favorited`: `DELETE WHERE story_id = ? AND person_id = ?`.
4. Return the fresh `FavoriteState` (re-read count + viewer flag).

**`getFavoriteState`** behavior: same SEE gate (call `getStoryForViewer`; `null` ⇒ throw or return
`{favoritedByViewer:false,count:0}` — pick throw for parity with the mutation, since the detail page
only calls it after `getStoryForViewer` already succeeded). Then `count = COUNT(*)` over
`story_id`; `favoritedByViewer =` existence of a row for `ctx.personId` (false when
`ctx.kind !== "account"`). **Never SELECT `person_id` into the returned shape.**

**`listFavoriteStoriesForViewer`** is specified but the "My favorites" filter UI is a **follow-up**
(not built in this unit) — ship the function so the seam exists; leave the filter for later.

### AuthZ = SEE, not OWN (subtlety)

Favoriting requires SEE permission but NOT ownership. Non-owners favorite freely; the owner can
favorite their own story. The gate is `getStoryForViewer` returning non-null — the exact same
front-door decision that governs whether the reader may open the page at all. There is no separate
authorization surface for favorites.

### Anonymity guarantee

The read functions return only a `number` and the viewer's own `boolean`. They never select or
return other persons' ids. The count is `COUNT(*)`; the viewer flag is an existence check scoped to
`ctx.personId`. The client (and therefore the owner) can never learn *who* favorited a story from
this unit. A test asserts the returned object has no person-identifying field.

### UI placement

- Heart (♡ / ♥) toggle button + count, rendered in the **card action row on the detail page**
  (`apps/web/app/hub/stories/[id]/page.tsx`), NOT in the owner kebab menu. This is the row Unit 01
  describes for favorite/like buttons; if that row does not exist yet when this unit lands, **create
  it** (a horizontal action row near the title/meta block, ~page.tsx lines 116-162, or just below
  the `<KindredListenBar>`). Note the loose relationship: this unit does not depend on Unit 01's
  `OwnerActionMenu` (favorite is not owner-gated), only on the shared action-row placement.
- **Detail view first** (this unit). The feed card (`apps/web/app/_kindred/KindredStoryCard.tsx`)
  is a **noted follow-up** — keep the slice small. The count MAY be shown read-only on feed cards
  in that follow-up; the interactive toggle ships on the detail view here.
- New client component, e.g. `apps/web/app/hub/stories/[id]/FavoriteButton.tsx`, taking
  `{ storyId, initialState: FavoriteState, canFavorite: boolean }`. Optimistic toggle is
  acceptable; the server action is the source of truth (reconcile on its returned `FavoriteState`).
- Server action in a colocated `actions.ts` (`"use server"`), mirroring
  `apps/web/app/hub/answer/[askId]/actions.ts`: re-read `getRuntime()` +
  `getCurrentAuthContext()` **server-side**, never trust a client-supplied `personId`; call
  `setStoryFavorite`; `revalidatePath` the detail route.
- The page computes `initialState` via `getFavoriteState(db, ctx, id)` (after `getStoryForViewer`
  already gated the page) and `canFavorite = ctx.kind === "account"`.

### Non-account viewer handling (decided)

For `ctx.kind !== "account"` (magic-link `link_session` and `anonymous`): **hide the toggle**
(there is no browsing-account identity to attribute a private bookmark to), but **still show the
count** (it is anonymous and safe). `canFavorite` is false → render the count as static text with no
interactive heart. `setStoryFavorite` also rejects these server-side (defense-in-depth).

## Plan (TDD)

Tests-first, in order. Core tests in `packages/core/test/`, web test in `apps/web/__tests__/`.

1. **Schema + migration.** Add `storyFavorites` + types to `schema.ts`; run
   `pnpm --filter @chronicle/db db:generate`. Confirm a new `drizzle/migrations/NNNN_*.sql` +
   updated `drizzle/schema.sql`. Run `pnpm --filter @chronicle/db test` — the **migration-drift
   test must stay green** (schema ⇄ migrations bonded).
2. **Core: authorized viewer can favorite.** RED test (PGlite): a non-owner co-member of a
   shared/approved story calls `setStoryFavorite({favorited:true})` → row exists, returned
   `favoritedByViewer:true`, `count:1`. Then owner favorites own story → `count:2`. Implement.
3. **Core: unauthorized (can't-see) rejected.** A viewer with no SEE permission (private story,
   non-owner; or a stranger) → `setStoryFavorite` throws `InvariantViolation`, NO row written.
   Also `anonymous` / `link_session` rejected.
4. **Core: idempotent.** Favoriting twice → still exactly one row, `count` unchanged (the
   `ON CONFLICT DO NOTHING` / unique index). Un-favorite twice → no error, row absent, `count:0`.
5. **Core: count correct + anonymity.** Three distinct persons favorite → `count:3`; each caller's
   `getFavoriteState` shows their own `favoritedByViewer` correctly. Assert the returned object
   exposes NO person id / no list of persons (structural anonymity check).
6. **Core: cascade on erase.** Favorite a story (by ≥1 person), then `eraseStory` by the owner →
   succeeds (no FK violation), favorite rows gone. This is the regression test for the CASCADE
   choice (project rule: companion regression test after a fix/decision).
7. **`index.ts` export.** Re-export `setStoryFavorite`, `getFavoriteState`,
   `listFavoriteStoriesForViewer`, `FavoriteState`, `StoryFavorite`.
8. **Web: toggle.** Component test for `FavoriteButton` (React Testing Library): renders the
   count; renders an interactive heart when `canFavorite` is true; renders count-only (no button)
   when false; optimistic flip on click. Wire `actions.ts` server action + mount in the detail-page
   action row. Confirm the page renders for owner, non-owner co-member, and a `link_session` viewer
   (heart hidden, count shown).
9. **Regression test** (project rule): the anonymity assertion (step 5) and the erase-cascade test
   (step 6) are the standing regression guards. Keep them.
10. **Green gates:** `pnpm --filter @chronicle/db test`, `pnpm --filter @chronicle/core test`,
    `pnpm --filter @chronicle/web typecheck test lint`, then `pnpm -r typecheck`.

## Done when

- [ ] `story_favorites` table added (open schema), with `(story_id, person_id)` UNIQUE and
      `ON DELETE CASCADE`; migration generated; drift-guard test green.
- [ ] `setStoryFavorite` / `getFavoriteState` / `listFavoriteStoriesForViewer` in
      `story-repository.ts`, exported from `index.ts`; SEE-not-own gate via `getStoryForViewer`.
- [ ] Favoriting is idempotent; count is `COUNT(*)`; read path returns only `{favoritedByViewer,
      count}` — never person ids.
- [ ] Erasing a favorited story cascades favorites away (no FK violation) — regression test present.
- [ ] Heart toggle + count in the detail-page card action row; hidden (count-only) for non-account
      viewers; server action re-reads auth server-side.
- [ ] Feed-card heart explicitly deferred (noted follow-up); "My favorites" filter deferred.
- [ ] All suites + `pnpm -r typecheck` green.

## Adversarial notes

- **Count leaks nothing about who.** The single risk is a read path that returns person ids
  "for convenience". It must not: `getFavoriteState` returns `number` + the caller's own boolean
  only. Guard it with the structural anonymity test (step 5). The owner must never be able to
  derive the favoriting set.
- **Erase cascade.** `eraseStory` does not delete `story_views` today (latent gap on a plain FK).
  Do NOT replicate that — favorites use `ON DELETE CASCADE`, so erase (and discard) can't
  FK-violate. Prove it with the erase-favorited-story regression test rather than trusting review.
- **Double-submit idempotency.** A fast double-tap or two tabs must not create two rows or throw:
  the `(story_id, person_id)` unique index + `ON CONFLICT DO NOTHING` makes concurrent favorites a
  no-op; the un-favorite `DELETE` is naturally idempotent. Optimistic UI must reconcile to the
  server-returned `FavoriteState`, not to a local increment.
- **SEE-not-own is the whole gate.** A missing `getStoryForViewer` check would let a stranger
  favorite (and thus increment the count on) a private story they can't see — a data-integrity and
  privacy leak (count inflation reveals interest in a hidden story). The gate is mandatory in BOTH
  `setStoryFavorite` and `getFavoriteState`.
- **PGlite migration-drift must stay green.** After `db:generate`, verify the snapshot and the new
  incremental migration agree; a hand-edit to one without the other trips the drift guard.
- **Don't drift into Unit 07.** "Favorite" is a private, anonymous-count bookmark; "like" is a
  visible, attributed reaction. Separate table, separate button, separate count. Resist merging.
