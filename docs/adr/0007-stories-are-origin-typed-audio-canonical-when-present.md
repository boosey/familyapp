# ADR-0007 — Stories are origin-typed (voice | text); audio is canonical only when present

Status: Accepted (2026-07-01) · **Implemented (2026-07-03, `feat+direct-story-creation`)**

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

## Implementation notes (2026-07-03)

Landed in `feat+direct-story-creation`. What shipped:

- **Schema** (`packages/db`): `story_kind` enum (`voice | text`); `stories.kind NOT NULL DEFAULT 'voice'`;
  `recording_media_id` nullable; CHECK `stories_kind_recording_ck` (`voice ⇒ recording present`,
  `text ⇒ recording NULL`, in `invariants.sql`). Added `user_authored` as the first
  `prose_revision_level` — the human-typed L1 analog of `ai_transcribed`.
- **Core** (`story-repository.ts`): `createTextDraft` (text draft + `user_authored` L1, no media/recording);
  `persistRecordingAndCreateDraft` sets `kind:'voice'` explicitly; `listOutstandingDrafts` generalizes
  the draft listing (self-initiated + ask-backed), with `listOutstandingAnswerDrafts` preserved as a
  latest-per-ask wrapper for the Questions tab.
- **Capture / pipeline**: `ingestTextStory` (no storage write); `pipeline.start()` routes text stories
  straight to `render_story` (skips `transcribe`); the pipeline view's media join became a LEFT join so
  a null-recording text story still resolves.
- **Web**: `composeStoryAction` (voice-or-text, ask-optional); `shareAnswerAction` persists an edited
  title; `AnswerFlow` → `StoryComposer` (voice⇄text toggle, editable title, reused for answer + tell);
  `/hub/tell` (+ `/hub/tell/[storyId]` resume); Stories-tab "Tell a story" entry + self-draft resume list.

### ⚠️ Load-bearing amendment (needs human sign-off) — prose-revision delete guard

Enabling draft *discard* for stories that carry prose revisions (every text draft carries a
`user_authored` L1; every rendered voice draft carries `ai_transcribed`/`ai_polished`) required
relaxing the `prose_revisions` mutation trigger from **blanket** append-only to **consent-scoped**:
UPDATE always forbidden; DELETE allowed only when the owning story has no `consent_records` row. This
mirrors the existing `chronicle_media_delete_guard` / `chronicle_story_recording_delete_guard` exactly,
and fixed a **pre-existing latent bug** (discarding any rendered voice draft would have FK-violated). The
`consent_records` ledger itself is untouched (still blanket append-only). Post-consent prose lineage is
still frozen forever. Because this relaxes a previously-absolute immutability trigger on a provenance
ledger, it should be consciously blessed at merge, and the dev/prod Neon branches must be **reseeded**
to pick up the new `invariants.sql` trigger (schema-parity deploy gate).
