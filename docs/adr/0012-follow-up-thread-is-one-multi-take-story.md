# ADR-0012 — A follow-up thread is one multi-take Story

Status: Proposed (2026-07-02)

## Context

We are adding AI **follow-ups**: after a narrator answers a question, the interviewer evaluates the
answer and may ask a gentle deepening question in the same sitting (see ADR-0013 for the evaluation
mechanism). This forces a modeling choice the schema does not currently allow. Today a Story has
exactly one recording — `stories.recording_media_id` is a single FK, with single `transcript` /
`prose` columns. A deepened answer is several recordings.

The alternative was **N linked Stories** (each answer its own Story via the existing one-shot
pipeline, tied by a `parent_story_id`). It ships in days and touches almost nothing — but it
fragments one memory into several feed cards and taxes the narrator with N approvals per sitting (or
forces a batch-approve we'd have to build anyway). A follow-up answer is *elaboration of the same
prompt*, not a new narrative the narrator independently chose to tell.

## Decision

An initial prompt plus the follow-ups it spawns — a **follow-up thread** — resolves to **one Story
with multiple ordered Takes and a single approval**.

- A `voice` Story may hold more than one **Take**. Each take is its own immutable Media (governed by
  ADR-0002); the canonical audio is the *ordered set*, never a concatenation (no re-encode, per the
  Clip/immutability rules).
- Each take is **transcribed as recorded** (it is the evaluator's input); the expensive prose
  **polish runs once** over the stitched transcript at thread completion, feeding review. Polish is
  never per-take and never runs on a thread abandoned before completion.
- One **approval** covers the whole thread. In review the narrator gets **per-take relisten**, one
  **stitched editable prose** field, and may **drop or re-record individual follow-up takes**
  pre-approval; dropping the *initial* take drops the thread (the follow-ups are orphaned without it).
  After approval every remaining take is immutable (the Draft guarantee), removable only by deleting
  the Story.
- A thread of length one (no follow-up asked, or the feature flag off) is exactly today's one-answer
  behaviour — this is backward-compatible and flag-gated.

## Consequences

- Schema change (reseed workflow, no incremental migration): a `story_recordings` ordered one-to-many
  replaces / supplements the single `recording_media_id` for voice stories; the render pipeline
  stitches take transcripts before the single polish.
- This **amends the `CONTEXT.md` Draft language**: within an active follow-up thread a draft holds
  per-take transcripts before approval. The spirit of "no tokens on a take that may be discarded"
  survives — transcription is cheap; the LLM polish stays deferred to thread completion.
- The Ask-answer surface is the only wired consumer in v1; base narration inherits the multi-take
  model when its turn-loop surface lands.
