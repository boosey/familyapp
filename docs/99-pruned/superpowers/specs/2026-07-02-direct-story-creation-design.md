# Direct story creation — design

Status: Approved (2026-07-02)
Branch: `worktree-feat+direct-story-creation` (rebased onto local master `95f0014`, the AI-polish work)

## Problem

Today a Story can only be created by **answering an Ask** — a question someone routed to the
narrator. The only account-side create route is `/hub/answer/[askId]`, and its server action
(`recordAnswerAction`) hard-requires an `askId` and validates the Ask's target/status before
ingesting. There is no way for a person to sit down and **tell a story on their own initiative**,
without being asked.

We want a person to create a story directly. Per the product owner, it should be **"just like
answering a question — both voice and text — except there is no question,"** plus a story title.

## Scope (decided)

1. **Text capture becomes a system-wide capability**, not just a direct-create feature. This
   implements the already-Accepted **ADR-0007** (stories are origin-typed `voice | text`; audio is
   canonical only when present). Text capture is added to **both** the existing answer flow and the
   new direct-create flow.
2. **Typed text is treated exactly like a transcript** — it goes through the same `render_story`
   stage (prose/title/summary/tags/era), so text and voice stories are identical downstream of
   capture. Text stories skip only `transcribe` (there is no audio).
3. **The title is always AI-generated, then editable in review** — for answers *and* self-initiated
   stories. There is no title input at capture time; the review step shows a title field
   prepopulated from the derived title, editable, persisted on share.
4. **The AI-polish capability** added by the other agent (`95f0014`: opt-in "Polish with AI" on the
   prose editor, backed by `polishProse`) folds into the canonical capture/review component so it
   works for voice *and* text, ask-backed *and* self-initiated.

### Non-goals

- No change to the Ask/interview loop, the follow-up mini-loop, the consent ledger, the state
  machine, or `approveAndShareStory` (all already `askId`-agnostic).
- No captions / photo-bound stories (ADR-0007 mentions them; out of scope here).
- No new visibility/targeting semantics — text stories reuse `story_families`/tier exactly.
- Text stories get no *automatic* extra metadata beyond what `render_story` already produces.

## Chosen approach — one generalized composer (Approach 1)

Refactor the answer flow's capture/review UI into a single **`StoryComposer`** component and a family
of server actions parameterized by an **optional** `ask`/`promptQuestion`. `/hub/answer/[askId]`
renders it with an ask; the new `/hub/tell` renders it with none. Voice vs. text is a mode toggle
inside the composer. This lifts the ask↔answer coupling — currently baked into `recordAnswerAction`
— into a parameter (exactly the seam the Engineering Spec says the Ask should be: "one of several
possible prompt sources feeding the same interviewer queue"), and keeps voice+text parity across
both surfaces without duplicating the flow.

Rejected: a parallel `/hub/tell` flow sharing only leaf components (would duplicate text-input work
across two orchestrations and let them drift); a barebones new-story form (contradicts "same UX as
answering").

### Shared-contract-first sequencing

Per the repo's parallel-work rule, the shared contract lands **before** the two UI surfaces:

1. **Foundation (blocking):** schema (`Story.kind`, nullable recording, CHECK, `user_authored`
   provenance level), core (`createTextDraft`, generalized draft listing), capture
   (`ingestTextStory`), pipeline (start-at-render for text).
2. **Surfaces (can parallelize after 1):** `StoryComposer` refactor + generalized actions; the
   `/hub/tell` route + Stories-tab entry point + draft listing.

## Data model / core

### Schema (`packages/db`, reseed workflow — no incremental migration)

- Add enum `story_kind = 'voice' | 'text'`.
- Add `stories.kind` — `NOT NULL DEFAULT 'voice'` (all existing rows are voice).
- Drop `NOT NULL` on `stories.recording_media_id` (keep the FK to `media`).
- Add DB CHECK constraints (in `drizzle/schema.sql` / `invariants.sql`):
  - `kind = 'voice' ⇒ recording_media_id IS NOT NULL`
  - `kind = 'text' ⇒ recording_media_id IS NULL` (a text story cannot carry stray audio).
- `story_recordings` (take-0 pointer, ADR-0012) is seeded **only for voice** stories.
- Add `'user_authored'` to the `prose_revision_level` enum (currently `ai_transcribed`,
  `ai_polished`, `human_corrected`, `ai_verified`). It is the L1 source level for text stories — the
  human-typed analog of `ai_transcribed`.

### Core write path (`packages/core/src/story-repository.ts` — the audited surface)

- `persistRecordingAndCreateDraft(...)` — unchanged signature; now sets `kind: 'voice'` explicitly.
- **New `createTextDraft(db, input)`** where `input = { ownerPersonId, text, promptQuestion?, askId?,
  originatingFamilyId? }`:
  - Inserts `stories` with `kind: 'text'`, `recordingMediaId: null`, `state: 'draft'`,
    `audienceTier: 'private'`, `transcript: text` (**not** `prose` — render fills prose/title),
    `promptQuestion`/`askId`/`originatingFamilyId` coalesced to null.
  - No `media` row, no `story_recordings` row.
  - Appends one `user_authored` prose-revision row carrying the typed text as the L1 source
    (via the existing `appendProseRevision`, which is in this allowlisted file).
  - Empty/whitespace `text` is rejected (`InvariantViolation`) — a text story must have words.
- Both creators share a private `insertDraftRow` helper for the common insert.
- **Generalize `listOutstandingAnswerDrafts` → `listOutstandingDrafts(db, personId)`**: returns
  `pending_approval` drafts for the person with `{ storyId, askId: string | null, kind, recordedAt }`
  (drops the `isNotNull(stories.askId)` filter). Keep a thin `listOutstandingAnswerDrafts` wrapper
  that filters to `askId != null` so the Questions tab's behavior is byte-for-byte unchanged.
- **Title persistence on edit:** the review step can edit the derived title. On share, an edited
  title is written to `stories.title` via the audited surface (extend the share action to call
  `updateDerivedFields(db, storyId, { title })` — or a focused `saveTitleCorrection` if a dedicated
  entry reads better). Ownership is already checked in the share action. (Title is a single derived
  field, not part of the prose-revision ledger, so no new revision row for a title edit.)

## Capture / pipeline

### Capture (`packages/capture`)

- **New `ingestTextStory(db, input)`** where `input = { actor, text, promptQuestion?, askId? }`:
  - Resolves `actor` → `personId` (+ `originatingFamilyId` for link sessions) via the existing
    `resolveCaptureActor`, identical to `ingestRecording`.
  - No object-storage upload (no bytes). Calls `createTextDraft`.
  - Returns the created story, mirroring `ingestRecording`'s shape.
- `ingestRecording` (voice) is unchanged.

### Pipeline (`packages/pipeline`)

- `render_story` already reads `stories.transcript` and produces prose/title/summary/tags, then
  transitions `draft → pending_approval`. For a text story, `transcript` is the typed text, so
  **render runs unchanged**.
- **`start(storyId)` branches on `kind`:** voice → enqueue `transcribe` (as today); text → enqueue
  `render_story` directly (skip transcribe, which would fail on a null recording). The branch reads
  the story's kind through the existing pipeline read seam (`getStoryAndRecordingForPipeline` /
  a lightweight kind read).
- The render stage's "no transcript yet → re-enqueue transcribe" self-correction is a no-op for text
  (transcript is always present and non-empty at create). No change needed there, but a text story
  must never be routed into `transcribe`.
- `promptQuestion` is null for `/hub/tell` stories; `render_story` and `polishProse` already treat it
  as optional framing.

## Web (the canonical component)

### `StoryComposer` (refactored out of `AnswerFlow.tsx`)

- Props: `{ ask?: { id: string; questionText: string; askerName: string } | null; mode: 'answer' |
  'tell' }`.
- **Question header** renders only when `ask` is present.
- **Capture step** gains a **voice ⇄ type toggle**: voice mode is the existing `MediaRecorder`
  path; type mode is a textarea whose contents are submitted as text.
- **Review step** (shared, both origins):
  - `KindredProseEditor` **with `onPolish`** (the "Polish with AI" button + undo/redo), so polish
    works for voice and text.
  - A **title field prepopulated from the derived `title`**, editable, shown in **both** modes.
  - Tier picker + Share, unchanged. Prose is editable in the editor for both origins. Voice keeps
    re-record / drop-take / discard as today; text offers **"start over"** (return to the textarea,
    discarding the draft) + discard. (The typed text is the source, so "re-record" becomes
    "re-type"; a fresh submission re-runs render.)
- The two-phase server-driven pattern (draft null ⇒ capture; draft present ⇒ review) is preserved.

### Server actions (ask-optional, in the answer route's `actions.ts` or a shared module)

- **`composeStoryAction(formData)`** — the generalized replacement for `recordAnswerAction`.
  Derives `personId` from the server session (`account` actor). If `askId` is present, it validates
  the Ask's target/status exactly as today; if absent, it is a self-initiated telling. Branches on
  submitted content: audio blob → `ingestRecording`; text field → `ingestTextStory`. Then
  `dispatchPipeline(storyId)`. Returns the existing `ThreadStep` union.
- **`polishStoryProseAction(formData)`** — ask-optional wrap of `polishProse` (passes
  `promptQuestion` only when there is an ask). Replaces/generalizes `polishAnswerProseAction`.
- **`shareAnswerAction`** — extended to also persist `correctedTitle` (when the narrator edited the
  title) alongside the existing optional `correctedProse` (L3). Otherwise unchanged (tap approval,
  consent record, best-effort augmentation).
- `discardAnswerAction` / follow-up actions — unchanged (already ask-agnostic).

### Routes & entry point

- **`/hub/tell`** — renders `StoryComposer mode='tell'` with no ask. Resume of an in-progress
  self-initiated draft lands here (or on a `/hub/tell/[storyId]` review, matching how
  `/hub/answer/[askId]` resumes).
- **Stories tab** gains a **"Tell a story"** entry point and lists the person's self-initiated
  `pending_approval` drafts (via `listOutstandingDrafts`), so ask-less drafts are resumable — closing
  the gap where `listOutstandingAnswerDrafts` never surfaced them.
- `/hub/answer/[askId]` is preserved: same route, now rendering `StoryComposer mode='answer'` with the
  ask, driven by the same generalized actions.

## Error handling & edge cases

- **Empty text** — blocked at the client (disabled submit) and the server (`createTextDraft` throws
  `InvariantViolation`); never reaches render.
- **Kind/recording invariant** — enforced structurally by the two CHECK constraints, so no code path
  can create a `text` story with audio or a `voice` story without it.
- **Text never enters `transcribe`** — `start()` routes text straight to render; the transcribe
  stage's "canonical recording missing" throw is therefore unreachable for text.
- **Polish failure** — already non-destructive (returns the words unchanged; inline error).
- **Multi-family owner, no originating family** — a self-initiated `family`/`branch` story with no
  `originatingFamilyId` lands `ambiguousDefaultTarget` at approval and stays owner-only until the
  narrator targets it explicitly (existing behavior; no new handling needed).
- **Idempotency** — render is gated on `prose` + `pending_approval` as today; re-dispatch of a text
  story is safe.

## Testing

- **db:** CHECK constraints reject `voice`-without-recording and `text`-with-recording; `story_kind`
  and `user_authored` enum round-trip.
- **core:** `createTextDraft` (fields, `user_authored` L1 append, empty-text rejection);
  `listOutstandingDrafts` returns both ask-backed and self-initiated drafts; the
  `listOutstandingAnswerDrafts` wrapper still filters to ask-backed only; title persistence on share.
- **capture:** `ingestTextStory` resolves the account actor, creates a text draft, no storage write.
- **pipeline:** a text story skips `transcribe`, renders from typed text, reaches `pending_approval`;
  provenance is `user_authored` → `ai_polished` (→ `human_corrected` on edit).
- **web:** `StoryComposer` in both modes and both input types; title field prepopulated + editable +
  persisted; polish button present for text; `/hub/tell` create → review → share end-to-end.
- **regression:** full run of the existing web suite (295) — `AnswerFlow → StoryComposer` is a
  refactor of a shipped surface. Per the repo's rule, each bug fixed during implementation gets a
  companion regression test.

## Open items (flagged, not blocking)

- **master divergence:** local `master` (`95f0014`, AI-polish, unpushed) and `origin/master`
  (`3c67222`, Clerk sign-in styling) have diverged at `7454848`. This branch is built on the local
  AI-polish tree. Someone must reconcile the two before/at merge — not resolved here.
- **ADR-0007 status:** implementing this feature *is* the implementation of ADR-0007. Its
  "Consequences" section should be marked done when this lands.
- Exact naming (`saveTitleCorrection` vs. inline `updateDerivedFields`; `composeStoryAction` name;
  whether the shared actions move to a `_actions` module) is left to implementation.
