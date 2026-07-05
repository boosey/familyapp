# Unit 07 — Like / thumbs-up (visible reaction)

**Prerequisite:** none hard. Sits in the card action row that Unit 01 establishes (or Unit
06 introduces); if neither exists yet, this unit creates the row. Does **not** depend on
Unit 06 — each defines its own table.
**Migration:** YES — a new `story_likes` table + one incremental migration applied to prod Neon.
**Blast radius:** `packages/db/src/schema.ts` (one new table + inferred types), the generated
snapshot/migration, `packages/core/src/story-repository.ts` (+ `index.ts` re-export), the story
detail page (`apps/web/app/hub/stories/[id]/page.tsx`) + a new client toggle component + its
server action. Cascade touch in `erasure-repository.ts` (`eraseStory`).

## Purpose

Give any authorized viewer a one-tap, **visible** way to react to a story — a thumbs-up with a
count everyone can see, plus a row of avatars showing *who* liked it (the likers the viewer is
authorized to see). This is the social counterpart to Unit 06's private favorite: a
favorite is a silent, owner-only bookmark; a like is a public signal to the family that "I saw
this and it landed." The two are structurally near-identical (per-person-per-story boolean +
count) but semantically opposite on the one axis that matters: **visibility**. This unit keeps
them as two independent tables so that opposite semantics can never leak into each other.

## Spec

### Visible-reaction semantics (LOCKED)

- A like is a **visible reaction**. Any account viewer authorized to *see* the story (the same
  read authorization as opening it) may like it.
- One like per person per story, idempotent (a `UNIQUE (story_id, person_id)`), toggleable
  (like → unlike removes the row). No like weight, no reaction kinds — just thumbs-up.
- The button lives **on the card / read-surface action row**, not in the owner kebab menu. It
  is **not owner-gated** — the owner may like their own story like anyone else (harmless; the
  count is honest). It sits alongside Unit 06's heart in the Unit-01 card action row.

### Who-liked visibility — DECISION

Because a like is *explicitly visible*, the design question is whether the UI reveals **who**
liked (names/avatars) or only a **count**.

**Decision for v1: ship the count + the viewer's own toggle state + the liker *list*
(names/avatars) — but the liker list is a LEAK-SAFE, viewer-scoped subset, never the full liker
set.** A like is an explicitly visible reaction, so showing *who* liked (as names/avatars) is
core to the feature, not a follow-up — provided the identities shown are only those the viewer is
already authorized to see.

The one hard constraint that makes this safe: **`count` and `likers` are NOT the same set.**
- `count` is the TOTAL like count (every liker) — a leak-free aggregate that reveals no identity.
- `likers` is ONLY the subset of likers the viewer may see: people who share an ACTIVE family
  membership with the *viewer*. It is generally a subset of `count`.

So a story with twelve likers may render as **"12 likes"** with avatars for only the **3** the
viewer personally shares a family with. The UI shows an honest total and a partial, safe roster —
never a name the viewer isn't entitled to.

Why the intersection is load-bearing (the leak this closes):
- A story visible to viewer V via family A may have been liked by person P who shares family B
  (not A) with the *owner* but **not** with V. Naively listing all likers would disclose P's
  existence/name to V across a family boundary V cannot see.
- `likers` therefore intersects the liker set against **the viewer's** active families, exactly
  mirroring the `loadStoryFamilyTargets` precedent (`apps/web/lib/hub-data.ts`), which only ever
  surfaces families the viewer belongs to. Resolved in SQL, never post-filtered in the consumer.
- `count`, being an aggregate, leaks no identity and so is unfiltered — but it MUST NOT be usable
  to enumerate the hidden likers (see Adversarial notes): the only thing V learns is *how many*,
  never *who*, for anyone outside V's family scope.

Note on avatars: `persons` carries `display_name` (see `packages/db/src/schema.ts` ~line 187) but
**has no avatar/photo column today**. So `likers` carries `{ personId, displayName }` as the
minimal display fields; the UI renders an initials/monogram avatar from `displayName`. When a
`persons` avatar/photo ref is later modeled, add it to the `likers` shape (additive) — the
leak-safe filter is unchanged.

### Separate table vs shared `story_reactions` — DECISION

`story_likes` (this unit) and `story_favorites` (Unit 06) are structurally almost identical. Two
options:

1. **Two separate tables** (`story_likes`, `story_favorites`) — RECOMMENDED and chosen.
2. A single `story_reactions` table with a `kind` (`'like' | 'favorite'`) discriminator column.

**Decision: two separate tables.** Reasons:
- **Opposite semantics, opposite guards.** A favorite is private (owner-only read); a like is
  public (count visible to all authorized viewers). Fusing them behind a `kind` column means one
  query/one authz path serves two visibility rules — exactly the kind of shared choke point where
  a future edit to one silently changes the other. Separate tables keep the private/visible wall
  structural.
- **Independent evolution.** Likes carry a viewer-scoped liker-list projection (leak-safe); favorites will not.
  Reactions may later add kinds; favorites are a fixed boolean. Divergent futures argue against a
  shared row shape.
- **No cross-unit dependency.** Units 06 and 07 may be built in any order or independently. A
  shared table would force one to define the contract the other consumes (a blocking dependency).
  Two tables let each unit own its own schema end to end.

The `story_reactions` alternative is noted for the record; revisit only if a *third*
near-identical reaction type appears, at which point a deliberate consolidation ADR is warranted.

### `story_likes` table (new, in `packages/db/src/schema.ts`)

Mirror the conventions of `story_views` (the closest existing per-viewer-per-story boolean table
— idempotent open state) and `story_families`:

```ts
export const storyLikes = pgTable(
  "story_likes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The story that was liked. */
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    /** The account-person who liked it. */
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One like per person per story — makes the like idempotent (onConflictDoNothing).
    uniqueIndex("story_likes_story_person_uq").on(t.storyId, t.personId),
    index("story_likes_story_idx").on(t.storyId), // count(*)/list by story
    index("story_likes_person_idx").on(t.personId), // "did I like it" / my likes
  ],
);
```

Plus inferred-type exports alongside the others at the bottom of `schema.ts`:

```ts
export type StoryLike = typeof storyLikes.$inferSelect;
export type NewStoryLike = typeof storyLikes.$inferInsert;
```

**Schema placement / guard note.** Like `story_views` and `story_families`, `story_likes` is NOT
Story *content* — it exposes only "person P reacted to story S", never any prose/transcript/audio.
It therefore lives on the **open** `@chronicle/db/schema` surface (freely importable), NOT behind
`@chronicle/db/content`. The read-authorization gate is enforced in the core function, not by the
schema wall.

### Migration steps (per CLAUDE.md)

1. Add `storyLikes` (+ types) to `packages/db/src/schema.ts`.
2. `pnpm --filter @chronicle/db db:generate` — emits BOTH the snapshot (`drizzle/schema.sql` +
   `drizzle/invariants.sql`) AND a new incremental migration `drizzle/migrations/0004_*.sql`
   (next in sequence after `0003_equal_master_mold.sql`). The table is plain (no trigger/invariant),
   so nothing needs hand-carrying into `invariants.sql` — the modeled diff is complete.
3. The **drift-guard test** (`packages/db/test/migration-drift.test.ts`) bonds snapshot ⇄ migration
   chain; it must stay green (it will, since both artifacts come from the one `db:generate`).
4. Applies to prod Neon at deploy via the Vercel build's `db:migrate`. Tests use PGlite against the
   snapshot — no external Postgres.

### Cascade on story erasure

`story_likes.story_id → stories.id` is a plain FK (no cascade), matching `story_families`/
`story_recordings`. `eraseStory` (`erasure-repository.ts`, ~107–198) deletes a story's children
explicitly before the `stories` row, so a `stories` delete with live like rows would raise an FK
violation. **Add an explicit delete of `story_likes` to `eraseStory`**, alongside the existing
`storyFamilies`/`storyImages` deletes (the non-consent children, deleted before the `stories` row):

```ts
await tx.delete(storyLikes).where(eq(storyLikes.storyId, input.storyId));
```

Likes carry no consent implication (a reaction is not content and not on the consent ledger), so
they may be deleted freely at any point in the cascade *before* the `stories` row — place the line
next to the `storyFamilies` delete. Import `storyLikes` from `@chronicle/db/schema` in the erasure
repo's open-schema import block (it is NOT a `/content` table).

> Alternative considered: declaring the FK `onDelete: "cascade"` so the DB reclaims likes when the
> story row goes. Rejected for consistency with the codebase's explicit-delete cascade discipline
> (`story_families`, `story_recordings`, `prose_revisions`, `story_images` are all no-cascade,
> deleted explicitly in `eraseStory`/`discardDraftStory`). Follow the house pattern: explicit delete.
> Also check `discardDraftStory` (`story-repository.ts`) — a draft can't have been seen/liked by a
> non-owner, but for FK safety add the same explicit `story_likes` delete there too (before the
> `stories` delete). It's a no-op in practice; it prevents a future "owner liked their own draft"
> path from wedging discard on an FK error.

### Core functions (new, in `packages/core/src/story-repository.ts`)

Add to the existing audited repository file — NOT a new file (keeps the architecture allowlist
tiny; the allowlist already covers `story-repository.ts`). Both functions authorize the **SEE**
permission first — a viewer who cannot read the story cannot like it or learn its like state.
Reuse the existing read authorization (`decideStoryRead` / `getStoryForViewer` from
`authorization.ts`) rather than re-deriving visibility.

```ts
export interface LikeState {
  /** Whether the current viewer has liked this story. Always false for non-account viewers. */
  likedByViewer: boolean;
  /**
   * TOTAL like count — every liker, a visible aggregate that reveals no identity. This is NOT
   * `likers.length`: `count` counts all likers, `likers` lists only the viewer-visible subset.
   */
  count: number;
  /**
   * LEAK-SAFE liker identities — ONLY the likers the viewer is authorized to see: persons who
   * liked this story AND share at least one ACTIVE family membership with the *viewer* (the
   * `loadStoryFamilyTargets` intersection, applied to persons). NEVER the full liker set. Empty
   * array (not undefined) when the viewer shares a family with none of the likers, or when the
   * viewer is a non-account identity. `persons` has no avatar column yet, so the minimal display
   * fields are `personId` + `displayName`; add an avatar/photo ref here when one is modeled.
   */
  likers: Array<{ personId: string; displayName: string }>;
}

/** Toggle the viewer's like on a story. SEE-authorized, NOT owner-gated. Idempotent. */
export async function setStoryLike(
  db: Database,
  ctx: AuthContext,
  input: { storyId: string; liked: boolean },
): Promise<LikeState>;

/** The visible like state for a story from this viewer's vantage. SEE-authorized. */
export async function getLikeState(
  db: Database,
  ctx: AuthContext,
  storyId: string,
): Promise<LikeState>;
```

**`setStoryLike` behavior:**
1. Resolve `viewer = viewerPersonId(ctx)`. A non-account viewer (`ctx.kind !== "account"`, i.e.
   `viewer === null`) has no attributable identity → throw `AuthorizationError` (there is no one to
   attribute the like to). The web layer hides the toggle for these viewers, so this is
   defense-in-depth.
3. **Authorize SEE:** load the story and run `decideStoryRead(db, ctx, story)`; if not allowed,
   throw `AuthorizationError` ("cannot like a story you cannot see"). *Can't like what you can't
   see* is the load-bearing check — it prevents a like from being used as an existence oracle for
   private stories.
4. If `input.liked`: `insert(storyLikes).values({ storyId, personId: viewer })
   .onConflictDoNothing({ target: [storyLikes.storyId, storyLikes.personId] })` — idempotent, one
   row max. Else: `delete(storyLikes).where(and(eq(storyId), eq(personId: viewer)))` — idempotent
   un-like.
5. Return the fresh `getLikeState` (re-read count + `likedByViewer`) so the caller/optimistic UI
   reconciles against the authoritative value.

**`getLikeState` behavior:**
1. Authorize SEE exactly as above (load story → `decideStoryRead`; deny → throw, OR return a
   zeroed state — pick **throw** for symmetry with `setStoryLike`; a viewer who can't see the
   story never renders the action row anyway).
2. `count` = `count(*)` over `story_likes` for the story.
3. `likedByViewer` = whether a row exists for `(storyId, viewer)`; always `false` when
   `viewer === null`.
4. `likers` — **v1 scope, leak-safe intersection.** Populate with the likers the viewer shares an
   ACTIVE membership with, exactly mirroring the `loadStoryFamilyTargets` precedent
   (`apps/web/lib/hub-data.ts`) and the family-target intersection in `authorization.ts`
   (`targetFamilies ∩ ownerActive ∩ viewerActive`). Concretely, in a single SQL query: join
   `story_likes` (for the story) → `persons` (for `display_name`) and keep only likers who hold an
   ACTIVE membership in some family in which the **viewer** also holds an ACTIVE membership —
   i.e. intersect the liker set against the viewer's active families
   (`memberships WHERE person_id = viewer AND status = 'active'`), resolved in SQL, never
   post-filtered in the consumer. The viewer's *own* like is always visible to them (they share a
   family with themselves trivially, or special-case it). When `viewer === null` (non-account),
   `likers` is `[]`. This must **NOT** simply list everyone who liked — that would leak identities
   across family boundaries the viewer cannot see. `count` (step 2) stays the unfiltered total, so
   `count >= likers.length` always.

Export both `setStoryLike`, `getLikeState`, and `type LikeState` from
`packages/core/src/index.ts` in the `./story-repository` export block.

### Authorization = see-not-own (summary)

- Liking requires the **read** permission on the story (`decideStoryRead`), NOT ownership. This is
  strictly narrower than the story being public — a `family`-tier story is likeable by any co-member
  who can already read it, and un-likeable/un-countable by anyone who cannot.
- The like is attributed to `viewerPersonId(ctx)`, re-derived server-side. The client's `personId`
  is never trusted (server-action convention, Unit 01).
- Non-account viewers (magic-link capture identities) cannot like — no attributable identity.

### UI

- A thumbs-up toggle button + visible count in the **card action row** on the detail page
  (`apps/web/app/hub/stories/[id]/page.tsx`), alongside Unit 06's heart. If the action-row
  container does not yet exist (Unit 01 not landed / Unit 06 built it), introduce it here near the
  title/meta block (around the tags/targets row, ~lines 177–214) or the page footer.
- New **client** component (e.g. `apps/web/app/hub/stories/[id]/LikeButton.tsx`): renders the
  thumbs-up + count, reflects `likedByViewer` (filled vs outline), calls the server action on click.
  **Optimistic toggle is OK** (flip the icon + count immediately) but the **server action is
  authoritative** — reconcile against its returned `LikeState` (revert on error/throw).
- **Liker avatar row.** Alongside the count, render a row of avatars for `LikeState.likers` — the
  viewer-visible subset only. Since `persons` has no photo column yet, render an initials/monogram
  avatar derived from `displayName` (with the name as tooltip/`aria-label`). **Cap the row** at the
  first N avatars (e.g. N = 5) and, when `count` exceeds what is shown, append a **"+K"** overflow
  chip. K is computed against `count` (the honest total), NOT `likers.length` — so "+K" may include
  likers the viewer cannot see; that is intended (it discloses only *how many more*, never *who*).
  If `likers` is empty but `count > 0` (viewer shares a family with none of the likers), show the
  count alone (e.g. "12 likes") with no avatars — never invent placeholder faces.
- Server action (`"use server"`, colocated `actions.ts` per Unit 01 convention): re-reads
  `getRuntime()` + `getCurrentAuthContext()` server-side, calls `setStoryLike`, then
  `revalidatePath('/hub/stories/' + storyId)` (and the hub feed path if the count surfaces there).
  Never accepts `personId` from the client.
- **Non-account handling:** when `ctx.kind !== "account"`, **hide the toggle** (no attributable
  identity, can't like) AND **hide the liker avatar row** — a non-account identity has no viewer
  family scope to intersect against, so `likers` is `[]` and no faces are shown. The **count may
  still show** (it's a visible aggregate) — render a read-only count without the toggle or avatars.
  State this explicitly in the component: toggle + avatars are gated on `ctx.kind === "account"`;
  count is unconditional.
- Design system: follow the existing Kindred idiom on this page (`_kindred` components, the pill /
  meta-row typography already in `page.tsx`). Match Unit 06's heart button so the two action-row
  buttons read as a pair.

### Recommended sequencing

Ship the **detail-view** toggle first (single story, `getLikeState` per page load). The **feed
card** (`apps/web/app/_kindred/KindredStoryCard.tsx`) is a follow-up — it needs a batched
like-count/own-state/liker load (one query for the whole feed page, mirroring
`loadStoryFamilyTargets`'s batch shape over `storyIds`, carrying the same per-viewer active-family
intersection for the liker subset) to avoid an N+1. Note it; don't build it in this unit.

## Plan (TDD)

Tests-first, ordered.

1. **Read** `schema.ts` (`storyViews`/`story_families` conventions), `story-repository.ts`
   (authz-first repo functions, `AuthorizationError`), `authorization.ts` (`decideStoryRead`,
   `viewerPersonId`), `erasure-repository.ts` (`eraseStory` cascade order), and
   `apps/web/lib/hub-data.ts` (`loadStoryFamilyTargets` leak-safe intersection).
2. **Schema + migration.** Add `storyLikes` + types to `schema.ts`. Run `db:generate`. Confirm
   `drizzle/migrations/0004_*.sql` + updated `schema.sql` emitted. `pnpm --filter @chronicle/db test`
   (drift-guard green).
3. **Core test first** (`packages/core/test/…`, PGlite): write failing tests for —
   - an authorized viewer (owner OR a co-member who can read a shared story) can like it; the row
     appears and `count`/`likedByViewer` reflect it;
   - a viewer who **cannot see** the story (`private` non-owner, or unshared) is **rejected**
     (`AuthorizationError`) on both `setStoryLike` and `getLikeState` — no row written, no count
     leaked;
   - a non-account (`ctx.kind !== "account"`) `setStoryLike` is rejected; `getLikeState`
     returns `likedByViewer: false` with an honest `count` and `likers: []` (no family scope to
     intersect against — no identities revealed);
   - **idempotent**: liking twice yields exactly one row / `count === 1`; un-liking twice is a
     clean no-op (`count === 0`);
   - toggle round-trip: like → `count 1, likedByViewer true`; unlike → `count 0, likedByViewer
     false`;
   - **count correctness**: three distinct co-members like → `count === 3`; each sees
     `likedByViewer` reflecting only their own row;
   - **liker-list is LEAK-SAFE (load-bearing, v1)**: set up a story visible to viewer V; have it
     liked by (a) person P who shares an ACTIVE family with V, and (b) person Q who likes the story
     but shares NO active family with V (e.g. Q co-inhabits a *different* family with the owner, or
     Q's shared membership is `ended`/`paused`). Assert: `count` includes BOTH P and Q, but
     `likers` contains P and **NOT** Q. Assert the viewer's own like appears in their own `likers`.
     Flip Q's membership to active-shared and assert Q now appears — proving the filter is the
     ACTIVE-membership intersection, not a static allowlist. Assert `count >= likers.length`.
4. **Implement** `setStoryLike` / `getLikeState` to green. Export from `index.ts`.
5. **Cascade test + impl.** Failing test: `eraseStory` on a story with like rows succeeds (no FK
   violation) and removes the like rows. Add the explicit `storyLikes` delete to `eraseStory` (and
   the defensive one to `discardDraftStory`). Green.
6. **Web toggle.** Component test (RTL, existing `apps/web/__tests__/` setup): renders count;
   renders the liker avatar row from `likers` (initials from `displayName`, name in
   tooltip/`aria-label`) with the N-cap + "+K" overflow computed against `count`; renders toggle +
   avatars for an account viewer, hides BOTH toggle and avatars (count-only) for a non-account
   viewer; shows count-only when `likers` is empty but `count > 0`; optimistic flip on click;
   reconciles/reverts on server-action rejection. Implement `LikeButton` + the server action; wire
   into the card action row on `page.tsx`.
7. **Regression test (project rule).** The "can't-like-what-you-can't-see" rejection test (step 3)
   AND the erase-cascade test (step 5) are the regression guards — keep them. Add a named regression
   test for the specific bug class this unit must not reintroduce: **a like on a `private` non-owner
   story must not create a row nor reveal the count** (existence-oracle guard).
8. **Green gate:** `pnpm --filter @chronicle/db test`, `pnpm --filter @chronicle/core test`,
   `pnpm --filter @chronicle/web typecheck test lint`, then `pnpm -r typecheck`.

## Done when

- [ ] `story_likes` table added; `db:generate` emitted snapshot + `0004_*` migration; drift-guard green.
- [ ] `setStoryLike` / `getLikeState` (+ `LikeState`) added to `story-repository.ts`, SEE-authorized
      (not owner-gated), idempotent, exported from `index.ts`.
- [ ] Non-account viewers cannot like; count is an honest aggregate; `likedByViewer` false and
      `likers: []` for them.
- [ ] Who-liked shipped in v1: `getLikeState` returns `{ likedByViewer, count, likers }` where
      `likers` is the LEAK-SAFE viewer-visible subset (viewer active-family intersection, SQL-resolved,
      mirroring `loadStoryFamilyTargets`) and `count` is the unfiltered total (`count >= likers.length`).
- [ ] Leak-safe liker test green: a liker outside the viewer's active-family scope appears in `count`
      but NOT in `likers`; a liker sharing an active family does appear.
- [ ] `eraseStory` (and defensively `discardDraftStory`) delete `story_likes` before the `stories`
      row; erase-cascade test green.
- [ ] Thumbs-up toggle + visible count + liker avatar row (N-cap + "+K" overflow against `count`)
      on the detail card action row; optimistic UI, server authoritative; toggle AND avatars hidden
      for non-account viewers (count-only).
- [ ] Feed-card like button explicitly deferred (with the batched-load note) — not built here.
- [ ] All suites + `pnpm -r typecheck` green.

## Adversarial notes

- **Likes are intentionally visible — favorites are intentionally anonymous.** Do NOT copy Unit
  06's private-read authz onto likes (that would hide the count, defeating the feature) and do NOT
  copy this unit's visible-count authz onto favorites (that would leak a private bookmark). The
  two-table decision exists precisely to keep these from cross-contaminating; resist any later
  "DRY it into `story_reactions`" refactor without an ADR that re-examines both visibility rules.
- **The central risk: leaking liker identities across family boundaries.** "Visible" means the
  *count* and the likers the *viewer* can see — it does NOT mean every liker's identity is public. A
  liker may share a family with the story owner but not with the viewer; listing them leaks a person
  across a family boundary the viewer cannot see. The **intersection filter is load-bearing**:
  `likers` MUST be intersected against the *viewer's* ACTIVE families
  (`loadStoryFamilyTargets` / `authorization.ts` `targetFamilies ∩ ownerActive ∩ viewerActive`
  pattern), resolved in SQL, never post-filtered in the consumer. A liker outside that scope must be
  absent from `likers`. Get this wrong and a family app quietly discloses who-knows-whom across
  households — the worst failure mode this unit has.
- **`count` must not become an enumeration oracle.** `count` is the honest unfiltered total and is
  allowed to exceed `likers.length` — that discloses only *how many* liked, never *who*. Do NOT
  "fix" the discrepancy by padding `likers` up to `count`, and do NOT expose any per-liker handle
  (id, order, timestamp) for the hidden likers through the count path or the "+K" chip. The only
  thing a viewer may learn about an out-of-scope liker is that they exist in the tally — a number,
  not an identity. Any endpoint that lets `count` be decomposed back into hidden individuals
  re-opens the very leak the intersection closes.
- **Existence oracle.** Authorize SEE *before* counting or inserting. If `getLikeState` returned a
  count (or `setStoryLike` succeeded) for a story the viewer can't read, the like endpoint becomes a
  probe for private-story existence. Deny (throw) uniformly, same as `getStoryForViewer` returning
  `notFound`.
- **Erase cascade.** A missing `story_likes` delete in `eraseStory` turns every owner-erasure of a
  liked story into an FK-violation 500. The cascade test is not optional. Likes carry no consent, so
  they delete freely before the `stories` row — but they MUST delete.
- **Double-submit / optimistic drift.** The `UNIQUE (story_id, person_id)` + `onConflictDoNothing`
  makes a double-tap like idempotent server-side; the optimistic UI must reconcile to the returned
  `count` (a fast double-click should not show `count` 2 then settle at 1 incorrectly). Un-like on a
  non-existent row is a clean no-op, not an error.
- **Migration-drift test** must stay green: the table is emitted by `db:generate` into both the
  snapshot and the `0004_*` chain migration; hand-editing only one of them breaks the bond.
- **Not owner-gated is deliberate** — do not "protect" the owner from liking their own story; it's a
  visible, honest signal and gating it adds a special case with no benefit.
