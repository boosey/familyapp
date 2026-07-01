# ADR-0007 — Stories are origin-typed (voice | text); audio is canonical only when present

Status: Accepted (2026-07-01)

## Context

The `stories` schema shipped with `recording_media_id NOT NULL`, which read as "expressive content
must have an audio origin." That was never the intent. The `CONTEXT.md` glossary already defined
`Story.kind` as `voice | text` with text stories having no recording — so the schema contradicted
the documented model. Surfaced during the photo/caption grill: a **caption** is a short Story bound
to a photo, and some captions are typed, so audio-mandatory would forbid a legitimate case. This
also retires the "text stories = Plan B" deferral.

## Decision

A Story has a `kind`:

- **voice** — has a required, canonical audio recording. The audio is the immutable source of truth
  (governed by ADR-0002); transcript/prose are derived and stay editable, but the audio is never
  overwritten and, once consented, never deleted.
- **text** — the typed response is canonical; there is no recording.

`stories.recording_media_id` becomes **nullable**, required iff `kind = 'voice'` (DB CHECK). The
"audio is the source of truth" spine is reframed precisely: audio is the source of truth **for
voice-origin content, and when present is never mutated** — not "every story must have audio."
Captions are short Stories (either kind) whose subject is a photo.

## Consequences

- Schema change (behind the reseed workflow, no incremental migration): add `stories.kind`; drop the
  `NOT NULL` on `recording_media_id`; add CHECK `kind='voice' ⇒ recording_media_id IS NOT NULL`.
- The story write path / state machine must set `kind` at creation and not assume a recording exists.
- ADR-0002 is unchanged: it governs immutability of the recording that a voice story *does* have.
