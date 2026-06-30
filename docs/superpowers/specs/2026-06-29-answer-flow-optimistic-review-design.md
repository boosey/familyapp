# Optimistic review screen for the in-hub answer flow

**Date:** 2026-06-29
**Status:** Approved (design)
**Area:** `@chronicle/web` — `apps/web/app/hub/answer/[askId]/`

## Problem

`recordAnswerAction` runs the whole pipeline inline — `ingestRecording → pipeline.start →
runToCompletion` (transcribe + render) — and only returns once the story is `pending_approval`.
The client awaits it before transitioning, so the narrator sits on the record screen in the
"saving / one moment" state for the entire upload + transcription + render duration.

With mock AI this was instant. With live Groq it is network-bound and **scales with recording
length**: a short clip is ~1s, but a multi-minute story is many seconds of staring at "one
moment" with no audio, no progress cue, and a single failure mode. It reads as frozen even when
it is working.

## Goal

The review screen appears **immediately** after the narrator stops recording: they can replay
their take right away, while a spinner + "Polishing your words…" message sits over the editor
until the prose is ready. Then the prose drops in all at once and the screen becomes the normal
review-ready screen (editor seeded, tier picker, Share).

Non-goal (deferred): streaming the prose in token-by-token. Revisit if/when we move to a
streaming LanguageModel.

## Approach (A — optimistic review, local audio, single refresh)

Render stays in the foreground (still awaited inside the existing `recordAnswerAction`); the
narrator simply never *sees* the record-screen wait. The instant they stop, the client already
holds the audio bytes, so it transitions to a review-pending screen that plays the recording
from a local object URL. When the awaited action resolves, one `router.refresh()` pulls the
finished prose through the server read path and the screen becomes review-ready.

Chosen over a true background render (split action + `after()` + client polling) because A
delivers the same UX, composes with the existing record→review `key` remount, touches no
backend/core/pipeline code, and adds **no new failure mode** — render is still awaited, so a
failure surfaces exactly as it does today. The background variant's only edge advantage
(surviving a mid-render tab close) is not handled by today's synchronous code either, so A is
no regression. Graduate to the background variant when we adopt streaming.

### Why a single `router.refresh()` and not a returned payload

Both are state-driven and trigger exactly one re-render; neither is polling. We re-read through
the server rather than returning prose from the write action because:

- **Single source of truth.** The review screen is already server-driven via the `draft` prop
  (`page.tsx`). A fresh load of an existing draft has only that path; hydrating in-session from
  an action return value would create a second feeder that must render identically. `refresh()`
  keeps one shared path.
- **The front door.** All Story content reads go through `getStoryForViewer` (load-bearing repo
  rule). `refresh()` re-reads prose through it; returning prose in the write action's payload
  routes content around that audited read.

## Component design — `AnswerFlow.tsx`

A third *visual* phase, driven by new client-local state, not by a new server prop.

New state, set in `stopRecording`:
- `localTake: { url: string } | null` — `URL.createObjectURL(blob)` of the just-recorded audio,
  revoked on unmount / on leaving the pending phase to avoid a leak.

Phases:
- **Record** (`draft == null`, `localTake == null`): unchanged.
- **Review-pending** (`localTake != null`, `draft == null`): question header, "just now"
  timestamp, `<audio src={localTake.url} controls>`, and a spinner + "Polishing your words…"
  panel occupying the editor's slot. Tier picker, Share, and re-record/discard are **hidden**
  until prose is ready — the narrator reviews their words before choosing an audience.
- **Review-ready** (`draft != null`): today's screen; editor seeded from `draft.prose` via the
  existing keyed remount.

Transition:
- `uploadRecording` keeps awaiting `recordAnswerAction`.
  - On success → `router.refresh()`. The arriving `draft` prop flips the `page.tsx`
    `key={draft?.storyId ?? "record"}` → AnswerFlow remounts → review-ready. The remount
    discards `localTake` (audio swaps to the server `mediaUrl`); the editor seeds from
    `draft.prose`.
  - On error → a message + "Record again" inside the pending panel (clears `localTake`, returns
    to record phase). Same failure surface as today.

`stopRecording` ordering: build the blob and set `localTake` (enter review-pending) up front,
then start the upload. The mic-permission/record softfail paths are unchanged.

## Scope of change

- **`AnswerFlow.tsx`** — the new phase + state + transition above. No new copy keys beyond a
  "Polishing your words…" string and a pending-error/"Record again" string (added to `_copy`).
- **No** changes to `page.tsx` data loading, `actions.ts`, `@chronicle/core`,
  `@chronicle/pipeline`, or the DB. `page.tsx` keeps surfacing only `pending_approval` drafts.
  (The `key` line stays as-is.)

## Testing

Extend `apps/web/__tests__/answer-flow-review-seed.test.tsx` (jsdom + Testing Library):
- Review-pending: with `localTake` set and `draft == null`, the editor (`role="textbox"`) is
  **absent**, the "Polishing your words…" message + spinner are present, and an `<audio>` element
  is rendered.
- Tier picker / Share are absent during review-pending.
- Keyed remount on `draft` arrival shows the seeded editor (already covered) — keep as the
  ready-state assertion.

Driving `stopRecording` in jsdom requires stubbing `MediaRecorder`/`getUserMedia`; if that proves
heavy, expose the pending phase via a minimal seam (e.g. render the pending branch from an
injected initial `localTake`) rather than mocking the full media stack. Decide during planning.

## Known wart (out of scope, no regression)

A render failure leaves an orphan `draft`-state story the client cannot directly discard — same
as today's `recordAnswerAction`. Not addressed here; flag separately if we want it fixed.
