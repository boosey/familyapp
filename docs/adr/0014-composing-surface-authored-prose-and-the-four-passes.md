# ADR-0014 — The composing surface: authored prose, per-take capture, and the four passes

Status: **Accepted (design) — 2026-07-03. Not yet implemented.**
Supersedes parts of the `2026-06-29 prose-provenance-and-human-correction` design (render-before-
review, "AI runs exactly once," polish-not-logged) and amends the "canonical" wording of **ADR-0007**.
Builds on **ADR-0012** (follow-up thread is one multi-take story) and **ADR-0004** (approval is a tap).

## Context

The first live test of "Tell a Story" exposed that the shipped flow was structurally wrong for what
we actually want. On stop it ran **transcribe + render together, automatically**, transitioned the
story to `pending_approval`, and only *then* dropped the narrator into an editor — the spinner
("Polishing your words") covered both AI stages and, on the deploy, never returned. But the deeper
problem was conceptual, not the hang:

- The editor was a **post-render review** surface, not a **live working** surface. You could not keep
  recording, and "record more" only existed as interviewer-driven follow-up takes that *re-rendered*
  (clobbering edits).
- Two different AI operations both wore the word "polish": the automatic light pass (`render_story`,
  DB level `ai_polished`) and the opt-in stronger rewrite button (`polishProse`, logged nowhere).
- The provenance model treated **prose as a regenerable derivation of audio**. That is false the
  moment a person types, hand-corrects, or the story mixes voice and text.

This ADR records the resolution reached in the 2026-07-03 grilling session. It governs **every**
capture surface — self-induced story, answering an Ask, and intake — because they share one surface.

## Decision

### 1. The editor lives in `DRAFT`; Finish ≠ Share

`DRAFT` becomes the **live composing surface**: it holds the audio take(s) *and* the editable text,
with recording/typing still active. Composition ends at an explicit **Finish**, which derives
metadata and transitions `DRAFT → PENDING_APPROVAL`. `PENDING_APPROVAL` shrinks to a light
**confirm title + pick audience tier + Share** screen. **Consent stays its own deliberate tap**
(ADR-0004); Finish is not Share. The state machine is unchanged — only the *timing* of the
`DRAFT → PENDING_APPROVAL` transition moves (to explicit Finish) and the editor moves earlier.

### 2. Four named text operations; the enum is renamed

- **Transcription** (`ai_transcribed`) — raw STT of a voice take.
- **Cleanup** (`ai_cleaned`, *renamed from* `ai_polished`) — the **automatic**, per-take pass:
  filler, false starts, sentence-joining, **and within-take self-corrections** (keeps the hedge when
  genuinely unsure; never guesses). Order-preserving; **sees one take only**.
- **Polish** (`ai_polished`, *the name now means the manual button*) — the **human-confirmed**,
  holistic pass: de-ramble/reorder and resolve **cross-take** self-corrections. Reversible.
- **Correction** (`human_corrected`) — the narrator's own hand-edit. Plus `user_authored` for a
  typed take's L1 (ADR-0007).

**Every AI pass is logged** to the append-only `prose_revisions` lineage — including **every Polish
tap**, even one later undone (fixes the prose-provenance gap where the manual polish was invisible
and, if kept, mislabeled `human_corrected`).

### 3. The pass-scope invariant

*Automatic passes (Transcription, Cleanup) see exactly one take; every holistic pass is
**human-confirmed** (the ✨ Polish button or the Finish check) — never silent.* This is what lets a
new take **append** without ever silently rewriting earlier words.

### 4. Append, never re-render

"Record more" (narrator-driven, or an interviewer follow-up in the story/answer flows — **not**
intake) appends a take; its Cleanup runs in isolation and is concatenated. Earlier text — including
hand-edits — is never re-flowed. Cross-take self-corrections are therefore out of Cleanup's reach and
are resolved only by Polish (§3).

### 5. The Finish check (detect-and-offer)

At Finish, a holistic scan looks for **unresolved self-corrections**; it **never applies silently** —
it offers ("tidy these up?") with a preview. Accept = a logged Polish; decline = ship as-is. Same
detect-and-offer discipline as Ask-suggestion / the follow-up decision record.

### 6. Voice and text interleave in one draft

Mic and keyboard are both live throughout. A **typed take** is L1 `user_authored` and **skips
Transcription + Cleanup** (the words are already authored); a **voice take** runs both. **Any audio
at all makes the story `voice`-kind** (ADR-0007). This requires the kind/recording CHECK to move off
the take-0 `recording_media_id` model to a per-take / "has any recording" model (audio already lives
per-take in `story_recordings`, ADR-0012).

### 7. Prose is authored; audio is the original record (amends ADR-0007)

The story's **source of truth is its approved prose** — a *composite* of spoken + typed + corrected +
polished input, sealed at approval. The **audio is the permanent original record** (playback, audit,
improvement; immutable once consented) but is **not** the regenerable source of the text. Only a
voice take's raw **transcript** is regenerable. ADR-0007's phrase "audio is the source of truth /
prose is derived and regenerable" is narrowed: "canonical" means **un-discardable original record**,
not regenerable-source.

### 8. Intake shares the interaction, not the authoring tail

Intake uses the same composing surface (record/type → Cleanup → edit → append → Polish → Finish
check) and the same editor + prose lineage, but is **not a Story**: no interviewer follow-ups, no
audience, no consent, never surfaced. It terminates at anchor extraction. Its audio + transcript are
**retained** (audit + improvement) — "keep all audio" is universal. Intake is also the **designated
first source of narrator memory** (seam ready via retention; the memory *model* is the deferred
"picture of the person" feature).

### 9. Memory extraction in every mode, consent-gated

Every mode mines what was said into system memory (anchor augmentation now; broader narrator memory
deferred). **Audit retention is unconditional; memory extraction is consent-gated:** a Story feeds
memory **only post-approval** (a discarded/unshared draft never does); **intake** extracts at Save
(answering is the consent). Best-effort.

## Consequences

- **Pipeline `render_story` splits** into per-take **Cleanup** (at record) + **metadata derivation**
  (title/summary/tags/era at Finish). The monolithic render-and-transition-on-stop is retired.
- **The regeneration contract is now lossy.** The orchestrator's "clear `prose` to re-render" rule
  must go: prose is authored-and-persisted and must **never be blindly regenerated** from
  audio/transcript (it would destroy typed takes + hand-corrections). Only the per-take transcript is
  safely regenerable.
- **Schema (reseed workflow, no incremental migration):** rename `prose_revision_level` value
  `ai_polished → ai_cleaned` and add a new `ai_polished` for the manual button; move the
  kind/recording CHECK to a per-take model. Dev/prod Neon branches reseed (schema-parity deploy gate).
- **`polishProse` action must thread `storyId`** and append an `ai_polished` row per tap (it is
  currently a bare text→text call).
- **The follow-up thread (ADR-0012) stops re-rendering** — its prose becomes concatenated cleaned
  segments like any other multi-take draft; "one story, one approval" is unchanged.
- **Observability:** the record/type/edit/polish/finish sequence must emit verbose logs across
  client + server (the original live test had none — `plog` is hard-off in prod). See the companion
  hang diagnosis.
- **Out of scope / deferred:** the narrator-memory model ("picture of the person"); interviewer
  follow-ups remain policy-flag-gated.

### ⚠️ Open implementation question — per-take latency (surfaced by the 2026-07-03 hang)

The first live test "hung" on *"Polishing your words"* not because anything failed — the story
reached `pending_approval` with transcript **and** prose — but because the **durable two-stage
Inngest hop** (`transcribe` then `render`, each its own function with cold-start + event round-trip +
real vendor latency) approached/exceeded the client's 180 s poll cap while running out-of-band.
Logs were invisible (`CHRONICLE_PIPELINE_LOG` off in prod), so a slow-but-working pipeline looked
dead.

This ADR *removes* the "auto-render then poll into review" gate — but it **moves the same latency to
every take**: the composing surface must return a take's transcribe+**Cleanup** fast enough to feel
interactive. A durable Inngest round-trip per take is almost certainly **too slow** for that loop.
**Decision needed at build time:** run **per-take transcribe+Cleanup synchronously in the capture
action** (short audio, single stage, returns inline — the current dev/CI synchronous path already
does this) and reserve the durable queue for heavier/optional/back-grounded work (e.g. metadata
derivation at Finish, memory extraction). And make the prod logging toggle usable for exactly this
class of "is it slow or stuck?" diagnosis.

## Alternatives considered

- **Keep the editor in `pending_approval`, just relabel** (today's model) — rejected: it can't host
  live "record more," which is the core ask.
- **Append re-renders the whole draft** (auto cross-take fixes) — rejected: clobbers hand-edits; the
  pass-scope invariant + Finish check give the same benefit without silent rewrites.
- **Auto-apply corrections at Finish silently** — rejected: violates "nothing holistic is ever
  unconfirmed."
- **Intake answers become Stories** (full authoring + consent) — rejected: turns a 6-question
  onboarding into an authoring marathon; intake stays anchor/memory extraction.
