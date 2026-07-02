# Intake capture UX — record, keep, transcribe, edit, save

**Date:** 2026-07-01
**Branch:** `worktree-feat+intake-ux`
**Status:** Approved design; ready for implementation plan.

## Problem

The biographical intake surface (`/hub/about-you`) was deliberately built as an
**ephemeral, text-only** walk (see `docs/superpowers/plans/2026-06-29-intake-surface-and-wiring.md`):
the voice button is a visible stub with no mic, and each answer is passed to
`extractIntakeAnswer` to populate a single `persons.biographical_anchors` field, then the raw
words are discarded. Confirmed against prod: the one real person's `biographical_anchors` is `{}`
and no raw intake text exists anywhere.

Four requirements retire that deferral:

1. The record button must actually work (mic capture is currently a stub).
2. Recordings must be kept.
3. Recordings must be transcribed and presented to the user to edit.
4. The text — whether transcribed or typed — must be saved.

This overturns the previous "intake answers are NOT stories / are ephemeral" decision, in line
with the newer decisions that audio-origin is not mandatory and text-stories are no longer deferred.

## Decisions (locked with the user; do not re-litigate)

- **Saved intake answers are private, durable, and editable**, and the member may choose to turn
  one into a shared story **later**. They are NOT auto-shared.
- **Storage model = a new dedicated `intake_answers` table** (NOT reused `stories`). This preserves
  the "intake answers are not stories" wall and keeps a pile of never-shared private drafts out of
  the story state machine and consent model. It is the heavier option (dedicated transcribe path +
  a future conversion path) and that cost is accepted.
- **Scope = capture only** (requirements 1–4). The "turn into a story" promotion path is a
  **follow-up**; the table is designed so it can be added cleanly, but it is not built now.
- **Implementation approach = A**: a dedicated lightweight intake capture path that reuses the
  recorder *UX* (a shared mic hook extracted from `NarratorRecorder`) but does its own thin ingest
  and calls the `Transcriber` seam directly — no `JobQueue`, no `render_story`, no consent gate.
- **Biographical extraction is retained**: the full answer is now saved AND still feeds
  `biographical_anchors` (best-effort; dev-without-key degrades, as today).
- **No audio playback in the intake edit UI now.** Audio is kept but not re-served during editing;
  intake media is not attached to a story, so the existing story-based `/api/media` authorization
  does not cover it, and owner-based media auth is deferred with promotion.

Because promotion is not reused-`stories`, the `stories.recordingMediaId NOT NULL` relaxation
(the flagged over-constraint) is NOT required for this build; it becomes a promotion-time concern.

## Data model — new `intake_answers` table (non-content)

```
intake_answers
  id             uuid pk
  personId       uuid → persons        (owner; the narrator)
  questionKey    text                  (a keyof BiographicalProfile, e.g. 'hometown')
  promptQuestion text                  (verbatim question text shown, snapshotted for durability)
  origin         enum('voice','typed')
  mediaId        uuid → media   NULL   (the kept audio; NULL for a typed answer)
  transcript     text           NULL   (raw ASR output; NULL for a typed answer)
  text           text  NOT NULL        ← the saved answer: edited transcript OR typed text [req #4]
  createdAt      timestamptz NOT NULL
  updatedAt      timestamptz NOT NULL
  UNIQUE(personId, questionKey)         (re-answering upserts; matches the one-per-field walk)
```

- New media kind `intake_audio` added to `media_kind` enum (distinct from `story_audio`).
- Deleting an `intake_answers` row cascades its `media` row (matches the deletion / content-audio
  rule: content audio is an un-detachable artifact that cascades on item delete).
- No `promotedStoryId` column now (YAGNI); promotion adds it later.
- `intake_answers` lives in the main (non-content) schema. Reads of its `text` are owner-only and
  need no front-door authorization gate. Only the `media` writes touch the guarded wall.

Schema workflow (per project convention): edit `schema.ts` → `db:generate` → reseed (no
incremental migration; prod branch is clean; no users → no backfill).

## Capture + transcribe flow (per question)

1. Question shown verbatim (unchanged). Two input paths: **Record** (now real) or **Type**.
2. **Record** → shared mic hook (`MediaRecorder`, opus/webm) → server action
   `submitIntakeRecording(questionKey, formData{audio})` (account-authed; re-resolves auth
   server-side, client never passes personId):
   - Storage-first invariant preserved: `storage.put("intake-audio/{personId}/{uuid}.{ext}")`
     write-once → immutable `media` row (`kind: intake_audio`, sha256 checksum) → `intake_answers`
     row (mediaId set, `text` seeded empty pending transcription).
   - Transcribe **synchronously** via the `Transcriber` seam directly → write `transcript` and seed
     `text = transcript`. Client shows a "transcribing…" state while the action runs. (Short intake
     clips make synchronous transcription acceptable within the function timeout; if that ever
     changes, a durable job can be added — noted, not built.)
3. The transcript lands in the **editable textarea** — the existing input, now pre-filled [req #3].
4. **Type** path → the textarea directly, `origin = 'typed'`, no media, no transcript.
5. **Save & Next** → `saveIntakeAnswerText(questionKey, editedText)` upserts `text`, then
   best-effort `extractIntakeAnswer(languageModel, question, text)` → `writeProfileField` into
   `biographical_anchors`, then computes the next question.
6. Completion signal: a question is "answered" when an `intake_answers` row exists for its
   `questionKey` (robust even when extraction fails), feeding `nextIntakeQuestion`. Exit-anytime
   still best-effort saves the current draft.

## Components / units

- **Shared mic hook** — extract the `getUserMedia` + `MediaRecorder` + chunk-buffer + stop→blob
  logic from `NarratorRecorder.tsx` into a reusable hook (e.g. `useMicRecorder`). `NarratorRecorder`
  refactors onto it (behavior-preserving); `AboutYouFlow` consumes it. One capture implementation,
  two consumers.
- **`AboutYouFlow.tsx` rework** — replace the stub `KindredVoiceButton` with a real record control;
  add the record → "transcribing…" → editable-textarea states alongside the existing typed path;
  wire Save & Next to the new actions.
- **`about-you/actions.ts`** — new `submitIntakeRecording` (ingest + transcribe) and
  `saveIntakeAnswerText` (upsert text + extract + next question). The old `submitIntakeAnswer` is
  superseded/renamed.
- **`packages/core/src/intake-answer-repository.ts` (new, allowlisted)** — owns all `intake_answers`
  and intake `media` writes: `createIntakeRecording` (storage-first media + row), `saveIntakeText`
  (upsert edited/typed text), read helpers for the walk. Added to the `ALLOWLIST` set AND the
  canary expectation in `packages/core/test/architecture.test.ts` (one deliberate, reviewed
  content-write-path addition).
- **Intake transcription orchestrator** — lives in `@chronicle/pipeline` (which owns the
  `Transcriber` vendor seam, per the vendor-seam rule): a thin `transcribeIntakeAudio(transcriber,
  audio)` that returns `{ text }`. The web action calls it, then persists the transcript via the
  core intake repository. No `JobQueue`, no `render_story`, no story coupling.

## Architecture guard

`media` is a guarded content table. The new `intake-answer-repository.ts` is the single audited
file that writes intake media; it is added to the `ALLOWLIST` and the exact-membership canary in
`architecture.test.ts`. No other file gains content-table access. `intake_answers` (non-content)
is accessed normally.

## Error handling

- Storage-first: if `storage.put` fails, no DB rows are written (mirrors `ingestRecording`).
- Transcription failure: leave `transcript` null and let the user type into the empty textarea;
  never strand the user. The kept audio remains; the answer is still savable as typed text.
- Extraction failure: best-effort try/catch; the field stays null and re-askable, the saved `text`
  is unaffected (mirrors today's behavior).
- Exit-anytime save is best-effort and never blocks navigation.

## Deliberate scope cuts

- No audio playback in the intake edit UI (audio kept, not re-served).
- No promotion / "turn into a story" path.
- No `JobQueue` / `render_story` for intake.

## Testing (TDD; regression companion per project rule)

- **db** (`packages/db`): `intake_answers` insert/upsert on `UNIQUE(personId, questionKey)`,
  cascade-delete of the linked `media` row, `intake_audio` enum present.
- **core** (`packages/core`): `createIntakeRecording` storage-first + immutable media + row created;
  typed save; edit-then-save updates `text`; architecture allowlist/canary updated and passing.
- **transcription orchestrator** (`packages/pipeline`): mock `Transcriber` → `transcribeIntakeAudio`
  returns text; failure path surfaces so the action can leave transcript null without throwing.
- **web** (`apps/web`): `AboutYouFlow` record → transcribe → edit → save, and typed → save (mocked
  actions); existing intake tests updated off the ephemeral/stub assumptions.

## Out of scope / follow-ups

- Promotion path: copy `intake_answers` → new draft `stories` row (reattach audio media), render
  prose, tier picker, `approveAndShareStory` + consent ledger. Would add `promotedStoryId` and the
  `stories.recordingMediaId` nullable relaxation for typed-origin promotions.
- Owner-based `/api/media` authorization to serve intake audio for in-edit playback.
