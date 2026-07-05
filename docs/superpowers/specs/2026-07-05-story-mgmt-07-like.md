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
count everyone can see. This is the social counterpart to Unit 06's private favorite: a
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

**Decision for v1: ship the count + the viewer's own toggle state; treat the liker *list*
(names/avatars) as a fast follow-up, gated on the same leak-safe filtering described below.**

Rationale:
- The count + own-toggle delivers the entire social signal ("this was seen and appreciated,
  and here's whether *I* reacted") with zero leak surface — a count is an aggregate that reveals
  no identity.
- Revealing liker identities is desirable in a family app and is *allowed* (likes are visible by
  definition), but it introduces a real leak vector: a story visible to viewer V via family A
  may have been liked by person P who shares family B (not A) with the *owner* but **not** with V.
  Naively listing all likers would disclose P's existence/name to V across a family boundary V
  cannot see. Getting that filter right is a discrete, testable piece of work, so it is scoped as
  its own step rather than bundled into the first landing.
- `getLikeState` returns an **optional** `likers` field from day one so the follow-up is additive
  (no signature churn): v1 returns `likers: undefined`; the follow-up populates it.

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
- **Independent evolution.** Likes may later grow a liker-list projection; favorites will not.
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
  /** Total like count (visible aggregate — no identity). */
  count: number;
  /**
   * OPTIONAL liker identities — populated only by the leak-safe follow-up (see below). Undefined
   * in v1. When present, contains ONLY likers the viewer is authorized to see (family members
   * sharing an active membership with the viewer), never the full liker set.
   */
  likers?: Array<{ personId: string; displayName: string }>;
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
4. `likers` — **v1: omit (`undefined`).** Follow-up: populate with a **leak-safe intersection** —
   the likers the viewer shares an ACTIVE membership with, exactly mirroring the
   `loadStoryFamilyTargets` precedent (`apps/web/lib/hub-data.ts`) and the family-target
   intersection pattern: intersect the liker set with the set of persons who co-inhabit at least
   one of the *viewer's* active families, resolved in SQL, never post-filtered in the consumer.
   This must **not** simply list everyone who liked — that would leak identities across family
   boundaries the viewer cannot see.

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
- Server action (`"use server"`, colocated `actions.ts` per Unit 01 convention): re-reads
  `getRuntime()` + `getCurrentAuthContext()` server-side, calls `setStoryLike`, then
  `revalidatePath('/hub/stories/' + storyId)` (and the hub feed path if the count surfaces there).
  Never accepts `personId` from the client.
- **Non-account handling:** when `ctx.kind !== "account"`, **hide the toggle** (no attributable
  identity, can't like). The **count may still show** (it's a visible aggregate) — render a
  read-only count without the toggle affordance. State this explicitly in the component: toggle is
  gated on `ctx.kind === "account"`; count is unconditional.
- Design system: follow the existing Kindred idiom on this page (`_kindred` components, the pill /
  meta-row typography already in `page.tsx`). Match Unit 06's heart button so the two action-row
  buttons read as a pair.

### Recommended sequencing

Ship the **detail-view** toggle first (single story, `getLikeState` per page load). The **feed
card** (`apps/web/app/_kindred/KindredStoryCard.tsx`) is a follow-up — it needs a batched
like-count/own-state load (one query for the whole feed page, mirroring `loadStoryFamilyTargets`'s
batch shape over `storyIds`) to avoid an N+1. Note it; don't build it in this unit.

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
     returns `likedByViewer: false` with an honest `count`;
   - **idempotent**: liking twice yields exactly one row / `count === 1`; un-liking twice is a
     clean no-op (`count === 0`);
   - toggle round-trip: like → `count 1, likedByViewer true`; unlike → `count 0, likedByViewer
     false`;
   - **count correctness**: three distinct co-members like → `count === 3`; each sees
     `likedByViewer` reflecting only their own row;
   - **(if `likers` included in this unit)** liker-list is **leak-safe**: a liker who does NOT share
     an active family with the viewer is absent from `likers` even though they contribute to
     `count`; a liker who does share an active family is present. (If `likers` deferred, write this
     test against the follow-up.)
4. **Implement** `setStoryLike` / `getLikeState` to green. Export from `index.ts`.
5. **Cascade test + impl.** Failing test: `eraseStory` on a story with like rows succeeds (no FK
   violation) and removes the like rows. Add the explicit `storyLikes` delete to `eraseStory` (and
   the defensive one to `discardDraftStory`). Green.
6. **Web toggle.** Component test (RTL, existing `apps/web/__tests__/` setup): renders count;
   renders toggle for an account viewer, hides toggle (count-only) for a non-account viewer;
   optimistic flip on click; reconciles/reverts on server-action rejection. Implement `LikeButton`
   + the server action; wire into the card action row on `page.tsx`.
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
- [ ] Non-account viewers cannot like; count is an honest aggregate; `likedByViewer` false for them.
- [ ] Who-liked decision recorded: v1 ships count + own-toggle; `likers` is the leak-safe follow-up
      (or, if built, filtered by the viewer's active-family intersection).
- [ ] `eraseStory` (and defensively `discardDraftStory`) delete `story_likes` before the `stories`
      row; erase-cascade test green.
- [ ] Thumbs-up toggle + visible count on the detail card action row; optimistic UI, server
      authoritative; toggle hidden for non-account viewers.
- [ ] Feed-card like button explicitly deferred (with the batched-load note) — not built here.
- [ ] All suites + `pnpm -r typecheck` green.

## Adversarial notes

- **Likes are intentionally visible — favorites are intentionally anonymous.** Do NOT copy Unit
  06's private-read authz onto likes (that would hide the count, defeating the feature) and do NOT
  copy this unit's visible-count authz onto favorites (that would leak a private bookmark). The
  two-table decision exists precisely to keep these from cross-contaminating; resist any later
  "DRY it into `story_reactions`" refactor without an ADR that re-examines both visibility rules.
- **The leak that hides in a "visible" feature.** "Visible" means the *count* and (optionally) the
  likers the *viewer* can see — it does NOT mean every liker's identity is public. A liker may share
  a family with the story owner but not with the viewer; listing them leaks a person across a family
  boundary. Any `likers` list MUST intersect against the viewer's active families
  (`loadStoryFamilyTargets` pattern), resolved in SQL, never post-filtered. When in doubt this unit
  ships count-only — a count leaks nothing.
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
