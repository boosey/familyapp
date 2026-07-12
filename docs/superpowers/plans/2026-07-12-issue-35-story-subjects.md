# Issue #35 — Story-subject tagging (who a story is about)

Status: DONE + GREEN (branch `worktree-issue-35-story-subjects`, stacked on #32 @ `c73768a`).
ADR: 0016 (story-subject tagging is in-scope for kinship v1, independent of the edge model).

## What shipped

Tag which Persons (members OR `mention`s, including newly-created ones) a Story is ABOUT via a
`story_subjects` Person↔Story link table. Tagging is a **plain association** — it never widens who
can see a story (ADR-0016: "kinship never drives authorization"; the same holds for subject tags).

## Table shape

`story_subjects` (behind `@chronicle/db/content` — it references the guarded `stories` table):

| column               | type        | notes                                             |
|----------------------|-------------|---------------------------------------------------|
| id                   | uuid PK     | `gen_random_uuid()`                               |
| story_id             | uuid NOT NULL FK→stories.id | ON DELETE no action                |
| person_id            | uuid NOT NULL FK→persons.id | the subject                        |
| tagged_by_person_id  | uuid NOT NULL FK→persons.id | audit: who applied the tag         |
| created_at           | timestamptz NOT NULL default now() |                             |

Indexes: `story_subjects_story_person_uq` UNIQUE(story_id, person_id), plus story_idx, person_idx.
NOT append-only (tag/untag is mutable) — no trigger. Consistent with ADR-0016 (edges are
append-only; subject tags are a separate lighter concept) and invariants.sql (no guard expected).

## Migration

`packages/db/drizzle/migrations/0010_slippery_scarlet_spider.sql` — emitted by `db:generate`
(snapshot `drizzle/schema.sql` + migration both updated). No hand-carried invariant (plain link
table). Drift-guard test green.

## Core functions (packages/core/src/story-repository.ts — already on the content ALLOWLIST)

- `tagStorySubject(db, ctx, { storyId, personId? , newPersonDisplayName? })` → `{ tagged, personId, createdPersonId? }`
  — exactly one of `personId` / `newPersonDisplayName`. The inline-mention path mints an identified
  `mention` Person (`origin='mention'`, `identified=true`, `spokenName` = first word), mirroring
  kinship-write.ts `insertMentionPerson`. Idempotent via `onConflictDoNothing`.
- `untagStorySubject(db, ctx, { storyId, personId })` → `{ untagged }`.
- `listStorySubjects(db, ctx, storyId)` → `StorySubjectView[]` (personId, displayName, taggedBy, createdAt).
- `listStoriesAboutPerson(db, ctx, personId)` → `Story[]`.

All exported from `packages/core/src/index.ts`.

## Authorization-scoping decision (the load-bearing guarantee)

- **Writes** (`tagStorySubject`/`untagStorySubject`): gated by `getStoryForViewer` (SEE) BEFORE any
  write. A viewer who cannot see the story cannot tag/untag; the inline mention is created only
  inside the post-gate transaction, so a denied attempt leaves no orphan Person. SEE (not owner-only)
  is the issue's explicit intent ("tag/untag on a story they can see"); a co-family viewer tagging a
  shared story is accepted by design.
- **`listStorySubjects`**: SEE-gated; a viewer who can't read the story gets `[]` (no leak of who a
  private story depicts).
- **`listStoriesAboutPerson`**: `WHERE storyVisibilityPredicate(viewer)` (the SQL form of the
  `decideStoryRead` oracle, property-tested to agree row-for-row) **ANDed** with an EXISTS on
  `story_subjects`. The subject link only ever NARROWS — a story the viewer cannot already read stays
  hidden even when they are the tagged subject. This is NOT a parallel content path: it reuses the
  same predicate the authorized story list uses. `${...}` interpolations are drizzle-parameterized
  (no injection).

The regression test `does NOT surface a story the viewer cannot see, even if the viewer is the
subject` proves it: the owner tags the *viewer themselves* on a private story; "stories about me"
returns `[]`.

## Web UI (apps/web)

- `apps/web/app/hub/stories/[id]/StorySubjectsSection.tsx` — "Who this is about" on story detail:
  card list of subjects (each linking to their about-page) + a name field to tag inline; remove
  buttons. Signed-in viewers may edit.
- `apps/web/app/hub/stories/[id]/actions.ts` — `tagStorySubjectAction` / `untagStorySubjectAction`
  (beginLogContext → getRuntime → auth guard → parse → core call → revalidatePath).
- `apps/web/app/hub/about/[personId]/page.tsx` — "Stories about X" list (calls
  `listStoriesAboutPerson` with the real AuthContext).
- Copy in `apps/web/app/_copy/hub.ts` under `subjects`.

## Cold-review finding (fixed) — cascade cleanup

`story_subjects.story_id → stories.id` is a plain non-cascading FK. The initial diff did NOT clear
subject rows before deleting the parent story in `discardDraftStory` (story-repository.ts) and
`eraseStory` (erasure-repository.ts) → an FK violation would roll back any delete of a tagged story.
FIXED: added `tx.delete(storySubjects)` to both child-cleanup blocks. Two regression tests added
(discard + erase a tagged story). Matches the project's "cascade tests must seed every child table"
lesson.

## Test coverage

`packages/core/test/story-subjects.test.ts` — 18 tests:
- tag existing / idempotent / SEE-gated refuse / anonymous refuse / co-family viewer tag
- inline mention create / blank-name reject / no-orphan-on-denied
- untag / untag SEE-gated refuse
- listStorySubjects (visible / no-leak)
- listStoriesAboutPerson: filter among authorized / **the no-leak regression** / co-family split /
  anonymous+public
- subject cleanup on discard + erase (the cold-review regressions)

Verification: `@chronicle/db test` (82, drift-guard green), `@chronicle/core test` (402),
core+web+db typecheck clean, architecture guard green (story_subjects behind content;
story-repository.ts allowlisted; no new allowlist entry needed).
