# Multi-family picker for chosen-audience content — Design

**Date:** 2026-07-05
**Status:** Approved (brainstorming), pending implementation plan

## Problem

A person can belong to more than one family. Content that the author *chooses an
audience for* must let them target one or more of their own families. Today this
is inconsistent:

- **Asks** have a real multi-family picker (`ask_families`) — the reference pattern.
- **Photo/album uploads** have a multi-family picker (`photo_families`), but its
  default selection is the current on-screen album, not the hub scope.
- **Self-stories ("tell")** have **no picker**. A multi-family author's self-story
  hits `computeDefaultFamilyTargets`' ambiguous branch and is surfaced into **no
  family**.
- **Answers** have **no picker**; family targeting is derived at approval from the
  answered ask's `ask_families`.

Goal: every surface where the author chooses a family audience presents the same
multi-family picker, seeded consistently.

## Scope

| Surface | Today | Change |
|---|---|---|
| Self-story ("tell") | no picker → targets nothing when multi-family | **Add** picker at share step, seeded from `?scope=` |
| Answer | no picker; derived from ask at approval | **Add** free picker at share step, seeded from ask's families |
| Photo upload | picker exists, defaults to current album | **Reseed** default from hub `?scope=` |
| Shared `<FamilyPicker>` | two divergent inline checkbox UIs | **Extract** one component + shared seeding |

**Out of scope (deliberately pickerless):**
- **Link-session capture (`/s/[token]`)** — the session is scoped to exactly one
  family by construction; a picker contradicts the model.
- **Intake ("about you")** — person-scoped biography, not family content.
- **Follow-up takes / typed appends / captions** — append to an existing item and
  inherit its targeting.

## Key decisions

- **Timing (approach A):** stories get their families at the **share step**, next
  to the existing `audienceTier` control — not at compose time. The approval path
  (`approveAndShareStory`) already honors an explicit `story_families` set, so this
  is the smallest correct change.
- **Answer picker is a *free* picker:** the answerer may target any of their own
  active families, including families the question was never asked into. It is
  bounded by the **answerer's** active memberships, **not** the ask's families. The
  ask's families are the *default* selection only.
- **Leakage on divergent target:** when an answer is targeted into a family the
  ask was never asked into, **suppress the ask attribution/question context** in
  that family's feed. The answer stands as its own story there. (Display-only.)

## Components

### 1. `<FamilyPicker>` (new, shared)
`apps/web/app/hub/FamilyPicker.tsx` (final location TBD in plan).

- Props: `families: {id: string, name: string}[]`, `selectedIds: string[]`,
  `onChange(ids: string[])`, plus a form-field `name` for progressive-enhancement
  server actions.
- Behavior: checkbox list. When the actor is in ≤1 family it renders nothing and
  the sole family is auto-resolved server-side (current behavior on every surface).
- Replaces the inline checkbox markup in `AskFamilyPicker` and `AlbumUploader`.
  The three join tables (`ask_families`, `story_families`, `photo_families`) are
  distinct relations and **stay**; only the UI and seeding unify.

### 2. Story share picker (self-story + answer)
Lives in the share sheet alongside the `audienceTier` selector
(`shareAnswerAction` in `apps/web/app/hub/answer/[askId]/actions.ts`; the same
actions back the `tell/` flow).

- Visible only when `audienceTier ∈ {family, branch}` (irrelevant for `public`).
- **Answer seed:** default-check `ask_families ∩ answerer's active families`;
  selectable across all the answerer's active families.
- **Self-story seed:** `seedComposeFamilies(scope, activeFamilies)`. Thread
  `?scope=` into `tell/page.tsx` (it does not read scope today). If ambiguous
  ("all" + multiple active families) and nothing chosen, block share with a
  "pick at least one family" error (`familyChoiceRequired`), mirroring asks.

### 3. Photo seed-from-scope
Thread `scope` into `AlbumUploader`; default selection becomes
`seedComposeFamilies(scope, families)` with a current-album fallback when no scope
signal is present. Write path (`createAlbumPhoto` / `photo_families`) unchanged.

## Data flow (stories)

```
share sheet  ──{ audienceTier, familyIds }──▶  shareAnswerAction
                                               │
                    resolveComposeFamilies(chosen, activeFamilyIds)  ← re-validate
                                               │
                    approveAndShareStory(..., familyIds)   ← extend core fn
                                               │
                    sets story_families in the SAME transaction;
                    approval honors the explicit set (skips computeDefaultFamilyTargets)
```

Asks and photos keep their existing creation-time write paths; only their picker
UI and default seeding change.

## Authorization

- Every surface re-validates the chosen family ids against the **actor's own
  active memberships** server-side, exactly as `createAsk` / `createAlbumPhoto`
  already do. The client value is never trusted.
- The answer picker's bound is the **answerer's** memberships, not the ask's.

## Edge cases

- **Single-family actor:** picker hidden; sole family auto-resolved.
- **`public` tier:** picker hidden/ignored; content goes public.
- **Ambiguous "all" + multiple families + nothing chosen:** block with
  `familyChoiceRequired`.
- **Zero active families:** guarded (should not occur for an authoring actor).

## Testing

- **Core (regression):** `approveAndShareStory` with an explicit `familyIds`
  (a) writes `story_families`, (b) rejects ids outside the owner's active
  memberships, (c) with ambiguous multi-family + no explicit list, requires an
  explicit choice rather than silently targeting nothing.
- **Web:** share action resolves and writes targets end-to-end; `<FamilyPicker>`
  renders nothing when `families.length <= 1`.
- Extend existing `compose-scope.ts` tests for the self-story seed path.

## References

- Ask multi-family pattern: `packages/core/src/asks.ts`,
  `apps/web/app/hub/tabs/AskFamilyPicker.tsx`, migration
  `packages/db/drizzle/migrations/0003_equal_master_mold.sql`.
- Scope helpers: `apps/web/lib/compose-scope.ts`.
- Story targeting: `approveAndShareStory` / `computeDefaultFamilyTargets` /
  `setStoryFamilyTargets` in `packages/core/src/story-repository.ts`.
- Hub scope selector: `apps/web/app/hub/HubScopeSelector.tsx`,
  `apps/web/app/hub/page.tsx`.
