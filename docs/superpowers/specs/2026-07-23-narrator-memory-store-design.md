# Narrator-memory store + extraction write-path — design (#362)

**Date:** 2026-07-23
**Issue:** #362 (fast-follow to #357) · **Branch:** `feat/narrator-memory-store` (off `origin/master` @ `133c52b`)
**Related:** ADR-0029, ADR-0014 §8/§9, `docs/superpowers/plans/2026-07-23-account-panel-redesign.md`

## Goal

Build the persistent **narrator-memory** store and its extraction write-path — the "broader picture
of the person" currently deferred behind a no-op sink (`noopNarratorMemorySink`) and a story-metadata
stand-in read (`listNarratorMemoryForInterviewer`). This is the fast-follow that lets #357's management
UI operate on real facts instead of only biographical anchors.

## Locked decisions (from brainstorming)

- **Separate table** `narrator_memory` — a fact-store, not story content.
- **Extraction = LLM** behind a pipeline seam with a versioned prompt-as-data; mock in tests.
- **Interviewer read = strict repoint (Option A):** `listNarratorMemoryForInterviewer` reads ONLY
  `narrator_memory` `active` rows. No cold-start fallback to story metadata. The store starts empty and
  fills as new stories are approved. **No backfill.**
- **Scope:** table + migration + core write-paths + extraction wiring at the two consent points +
  interviewer read + tests. **No #357 CRUD UI** (it stays anchors-backed until it repoints separately).

## Data model

New table on the **OPEN schema** (`packages/db/src/schema.ts`, beside `life_events` / `consent_records`).
Rationale: it holds title/summary/tags — the lowest-sensitivity, already-derived story metadata plus
person facts — and is an interviewer input like `life_events`, not Story content. It is therefore NOT
behind `@chronicle/db/content`, needs no architecture-allowlist entry, and its FK to `stories.id` is a
plain reference (an FK grants no content read).

```
narrator_memory
  id            uuid  pk  default random
  seq           bigserial  notNull        -- deterministic total order (like consent/prose ledgers)
  person_id     uuid  notNull  → persons.id
  title         text  notNull
  summary       text  notNull
  tags          text[] notNull default {}
  origin        narrator_memory_origin  notNull        -- 'extracted' | 'user'
  source_story_id uuid  → stories.id (nullable)         -- provenance for extracted; null for user-authored
  confidence    real   (nullable)                       -- extractor's confidence; null for user-authored
  status        narrator_memory_status  notNull default 'active'  -- 'active' | 'superseded' | 'dismissed'
  superseded_by uuid  → narrator_memory.id (nullable, self-ref)
  created_at    timestamptz notNull default now()
  indexes: (person_id), (person_id, status), (source_story_id)
```

Two new enums: `narrator_memory_origin`, `narrator_memory_status`.

### Append-only discipline — the important nuance

The contract's "correction → new `active` row + prior marked `superseded`; removal → `dismissed`"
requires **status UPDATEs**, so this table CANNOT use the consent ledger's forbid-all-mutation trigger.
Instead we enforce **content immutability while permitting lifecycle transitions**, at two layers:

1. **DB trigger** `chronicle_narrator_memory_guard` (hand-carried into `invariants.sql` + the emitted
   migration). `BEFORE UPDATE` only: RAISE if any *content* column changes
   (`person_id, title, summary, tags, origin, source_story_id, confidence, created_at, seq`); permit
   changes limited to `status` and `superseded_by`. DELETE is **not** guarded — account/story erasure
   must be able to remove rows (see Erasure).
2. **Repository** exposes only insert + status-transition + read. No content-edit path exists.

A correction is therefore a *new row* (never an in-place edit); the interviewer only ever reads
`status = 'active'`. This gives the "structural, not just convention" guarantee the codebase values,
matching the two-layer pattern the consent ledger uses.

## Extraction seam (pipeline)

New `packages/pipeline/src/extract-narrator-memory.ts`, mirroring `extract-biography.ts`:

```ts
export interface ExtractedMemory { title: string; summary: string; tags: string[]; confidence: number }
export async function extractNarratorMemory(text: string, llm: LanguageModel): Promise<ExtractedMemory[]>
```

- Versioned **prompt-as-data**: a `SYSTEM_PROMPT` constant + `NARRATOR_MEMORY_EXTRACT_LLM_TEMPERATURE` /
  `NARRATOR_MEMORY_EXTRACT_MAX_OUTPUT_TOKENS` in `packages/pipeline/src/constants.ts`.
- Asks for raw JSON: an array of `{title, summary, tags[], confidence 0..1}`. **Defensive parse** →
  `[]` on any unparseable / non-array / empty response (a failed inference writes nothing, never throws).
- Deterministic mock path: the existing `ScriptedLanguageModel` returns scripted JSON in tests.

## Core write/read paths

New `packages/core/src/narrator-memory-repository.ts` (open schema only — no `@chronicle/db/content`):

- `recordExtractedMemories(db, { personId, source, sourceStoryId?, facts })` — inserts one `active`
  row per fact, `origin='extracted'`, carrying `sourceStoryId` (story path) / null (intake path) and
  the fact's `confidence`. Empty `facts` → no-op. **Never mutates existing rows**, so a user-authored
  fact can never be overwritten by extraction (the precedence AC is satisfied structurally). Semantic
  dedup against prior rows is out of scope (noted; a later refinement).
- `authorNarratorMemory(db, { personId, title, summary, tags })` — inserts an `active` row,
  `origin='user'`, no source/confidence. (The write path #357's "add a memory" will call.)
- `supersedeNarratorMemory(db, { memoryId, replacement })` — one tx: insert a new `active`
  `origin='user'` row + set the prior row `status='superseded', superseded_by = new.id`. Guards the
  prior row is currently `active`.
- `dismissNarratorMemory(db, { memoryId })` — sets `status='dismissed'` on an `active` row.
- `listNarratorMemoryForInterviewer(db, personId, limit)` — **repointed**: selects `status='active'`
  rows for the person, most-recent-first, capped at `limit`, projecting the safe fields. Keeps the
  existing return shape `{ storyId, title, summary, tags, promptQuestion, createdAt }` as a drop-in for
  the interviewer adapter: `storyId = source_story_id ?? id`, `promptQuestion = null`. This function
  MOVES out of the allowlisted `story-repository.ts` (it no longer reads the `stories` content table)
  into the new repository; `@chronicle/core`'s index re-exports it under the same name (no call-site
  churn). The old story-reading implementation is deleted.

## Sink widening + wiring

- **Seam** (`packages/core/src/narrator-memory.ts`): widen `NarratorMemoryInput` with an optional
  `sourceStoryId?: string` (the story path supplies it; intake omits it). `noopNarratorMemorySink`
  stays for tests that don't care.
- **Real sink** — `apps/web/lib/narrator-memory-sink.ts` (the composition root already imports both
  core and pipeline, avoiding a new cross-package dependency):
  ```ts
  createNarratorMemorySink(db, languageModel): NarratorMemorySink
  // record({personId, source, text, sourceStoryId?}):
  //   facts = await extractNarratorMemory(text, languageModel)
  //   if (facts.length) await recordExtractedMemories(db, {personId, source, sourceStoryId, facts})
  ```
- **runtime.ts**: replace `narratorMemory: noopNarratorMemorySink` with
  `createNarratorMemorySink(db, languageModel)`.
- **Call-sites** (already placed, best-effort in their own try/catch — unchanged control flow):
  - `shareAnswerAction` (story, post-approval): add `sourceStoryId: storyId` to the `record` call.
  - `saveIntakeAnswer` (intake, at Save): unchanged (no source story).

## Erasure cascade

`narrator_memory.person_id` and `.source_story_id` are plain FKs (no Postgres cascade), so the audited
erasure paths must remove rows explicitly (DELETE is permitted by the guard):

- **`eraseStory`** (post-share story erasure): `DELETE FROM narrator_memory WHERE source_story_id = $1`.
  Facts mined from an erased story go with it; user-authored facts (`source_story_id IS NULL`) are
  untouched.
- **`eraseAccount`** (ADR-0016): `DELETE FROM narrator_memory WHERE person_id = $1`.
- **`discardDraftStory`**: no action needed — a draft is pre-consent, so no memory row ever references it.

Cascade/erasure tests seed full fixtures (owner rule) including at least one `narrator_memory` row.

## Testing

- **db**: migration-drift guard (`test/migration-drift.test.ts`) stays green after `db:generate`;
  trigger behavior — a content-column UPDATE RAISEs, a `status`/`superseded_by` UPDATE succeeds
  (PGlite).
- **core** (`narrator-memory-repository.test.ts`): record inserts active extracted rows with
  provenance/confidence; author inserts a user row; supersede creates new active + marks prior
  superseded with `superseded_by`; dismiss flips status; list returns only active, newest-first,
  capped; extraction never overwrites a user row.
- **pipeline** (`extract-narrator-memory.test.ts`): scripted JSON → parsed facts; garbage/empty → `[]`.
- **web** (`narrator-memory-gating.server.test.ts`): update the existing gating expectations for the
  widened `record` shape (story call now carries `sourceStoryId`); add a test that the wired sink
  actually writes `active` rows post-approval and none on discard. Keep the §9 gating locks.
- **erasure**: eraseStory / eraseAccount remove the person's / story's memory rows; companion
  regression test.

## Build sequence

1. **Shared contract first** (blocking): schema (table + 2 enums), types re-export, `db:generate`,
   hand-carry the trigger into the migration + `invariants.sql`, drift-guard green. Everything
   downstream depends on these types.
2. Pipeline extractor + prompt/constants + mock test.
3. Core repository (write + read + repoint) + tests.
4. Sink widening + real sink + runtime wiring + call-site `sourceStoryId`.
5. Erasure cascade + regression tests.
6. Update the web gating test; full preflight; PR.

## Out of scope

- #357 CRUD UI repoint (separate).
- Semantic dedup of extracted vs. existing facts.
- Backfilling memory from historical approved stories.
