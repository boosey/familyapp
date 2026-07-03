# ADR-0014 Composing Surface — Frozen Shared Contract (Inc 1–4)

> **Blocking shared-contract step** (repo CLAUDE.md "Shared Contracts First"). This freezes the take
> model, prose provenance keying, the kind/recording invariant, the core write-path signatures, and
> the pipeline seam signatures that Inc 1 (pipeline), Inc 2 (core/db/invariants), Inc 3 (web), and
> Inc 4 (intake) all consume. **Do not renegotiate these in an increment plan** — if an increment
> needs to change the contract, stop and amend this doc first.
>
> Two build-time decisions were confirmed with the product owner (2026-07-03): **(1) add a per-take
> `story_recording_id` FK to `prose_revisions`**; **(2) fix the media-delete guard in Inc 2** to
> protect all consented-story take audio. Both are reflected below.
>
> Ground truth this is built on: `docs/superpowers/plans/2026-07-03-composing-surface-adr0014-rollout.md`,
> ADR-0014, `CONTEXT.md`, and the two architecture maps produced this session (DB/core/capture +
> pipeline/web). Schema/invariant changes ride the **reseed workflow** (no incremental migration);
> **both Neon branches reseed before deploy** (schema-parity gate) — an operational step tracked
> separately, NOT part of any increment's code task.

---

## 1. The composing model (what a draft is now)

A **draft** (`stories.state = 'draft'`) is a live composing surface holding an ordered sequence of
**takes**, each either **voice** or **typed**, freely interleaved:

- **Voice take** → one immutable audio `media` row + one `story_recordings` row (`position` = next
  0-based **audio-take** index). Its raw ASR lands on `story_recordings.transcript`. It contributes
  two prose-lineage rows (below) and its **Cleanup segment** to the working prose.
- **Typed take** → **no** audio, **no** `story_recordings` row. It contributes one `user_authored`
  prose-lineage row and its **verbatim text** to the working prose.

**`stories.prose` is the persisted working text** — the ordered concatenation of each take's
contribution (voice: Cleanup segment; typed: verbatim), plus any hand-edits. It is written on **every
append** (server concatenates the client's current editor text + the new segment) and at **Finish**.
It is **authored, never regenerated** from audio (ADR-0014 §7): no code path may clear `prose` to
re-render it.

**`story_recordings.position` orders audio takes only** (for relisten). The **full composition order**
(voice + typed interleaved) is the `prose_revisions.seq` order + `stories.prose`. This is deliberate:
typed takes have no audio to order.

State timing (state machine unchanged; only the transition *timing* moves):
`draft` — the live editor (record/type/append/hand-edit/Polish). **Finish** derives metadata, snapshots
a `human_corrected` row if the text was edited, and transitions `draft → pending_approval`.
`pending_approval` — light confirm-title + pick-tier + **Share**. Share (consent) is its own tap.

---

## 2. Prose-lineage provenance keying (the confirmed FK)

`prose_revisions` gains a **nullable** `story_recording_id uuid REFERENCES story_recordings(id)` column
(`storyRecordingId` in Drizzle). Keying rules — **frozen**:

| Level | When appended | Text held | `story_recording_id` | `model_id` | `prompt_text` | `actor_person_id` |
|---|---|---|---|---|---|---|
| `ai_transcribed` | per voice take (record) | that take's **raw** transcript segment | **the take** | STT model | null | null |
| `ai_cleaned` | per voice take (record) | that take's **Cleanup** segment | **the take** | LM model | cleanup prompt | null |
| `user_authored` | per typed take (append) | that take's **verbatim** text | **null** | null | null | the narrator |
| `ai_polished` | manual ✨ Polish tap OR Finish-check accept | the **whole** polished prose | null (holistic) | LM model | polish prompt | null |
| `human_corrected` | at Finish, iff edited | the **whole** edited prose snapshot | null (holistic) | null | null | the narrator |
| `ai_verified` | reserved (unused) | — | — | — | — | — |

Rule of thumb: **per-take automatic rows carry the take; holistic rows do not.** A null
`story_recording_id` means "not tied to one audio take" (either a typed take or a holistic pass — the
`level` disambiguates).

`AppendProseRevisionInput` gains an optional `storyRecordingId?: string`. Existing call sites
(orchestrator/multi-take whole-story renders that stay for now) pass nothing → null, unchanged.

---

## 3. The kind / recording invariant (mixed drafts)

**Target invariant** (replaces the old take-0-only `stories_kind_recording_ck`):
- `kind = 'voice'` **⟺** the story has **≥1 `story_recordings` row** (any audio ⇒ voice).
- `recording_media_id IS NOT NULL` **⇒** `kind = 'voice'` (the pointer, when set, is the first *voice*
  take's media).
- `kind = 'text'` **⇒** `recording_media_id IS NULL` **and** 0 `story_recordings` rows.

**`recording_media_id` semantics (frozen):** it stays the **take-0-voice** pointer and remains
**immutable** (the existing `chronicle_story_recording_pointer_immutable` trigger is UNCHANGED). A
**typed-first** draft that later gets a voice take keeps `recording_media_id = NULL` — its canonical
audio is the `story_recordings` set, not a single pointer. We do **not** re-aim the pointer.

**Enforcement (frozen mechanism):**
1. Keep a single-table CHECK: `NOT (kind = 'text' AND recording_media_id IS NOT NULL)` (text ⇒ null
   pointer). This half needs no cross-table lookup.
2. Replace the voice half with a **DEFERRABLE INITIALLY DEFERRED constraint trigger** (in
   `invariants.sql`) on **both** `stories` (kind changes) and `story_recordings` (insert/delete),
   asserting at COMMIT: `(kind = 'voice') = (EXISTS a story_recordings row for the story)`. Deferred so
   the repo may, within one tx, insert the first voice take and flip `kind` in either order.
3. The audited repo **flips `kind` `text → voice` in the same tx** when the first voice take is
   appended to a typed-first draft. (kind never flips back voice → text; dropping the last take of an
   already-voice draft is out of scope — a voice draft stays voice.)

**Media-delete guard hardening (confirmed in-scope):** extend `chronicle_media_delete_guard` so DELETE
is also forbidden when the media is referenced by **any `story_recordings` row whose story has a
consent record** (today only take-0-via-`recording_media_id` + approval audio are protected). Closes
the silent-audio-loss gap for `position ≥ 1` and typed-first mixed takes. Ships with a regression test.

---

## 4. Core write-path signatures (Inc 2 — all in `story-repository.ts`, on the ALLOWLIST)

LM/vendor calls **never** enter core (vendor-seam rule). Core receives already-cleaned text /
already-derived metadata as inputs. New/changed exports:

```ts
// Append the provenance + working-prose for a freshly recorded & cleaned VOICE take.
// Persists: ai_transcribed(rawSegment, storyRecordingId) + ai_cleaned(cleanedSegment, storyRecordingId);
// updates stories.prose = priorProse ? priorProse + "\n\n" + cleanedSegment : cleanedSegment;
// flips kind text→voice iff needed (same tx). The media + story_recordings row already exist
// (capture.ingestRecording / ingestFollowUpTake created them); storyRecordingId identifies the take.
// Owner + state='draft' gated. Returns the new full prose + the appended segment.
appendVoiceTakeContribution(db, input: {
  storyId: string; ownerPersonId: string; storyRecordingId: string;
  rawTranscript: string; cleanedSegment: string;
  transcribeModelId: string; cleanupModelId: string; cleanupPromptText: string;
  priorProse: string | null;
}): Promise<{ prose: string; appendedSegment: string }>

// Append a TYPED take: user_authored(text, storyRecordingId=null); prose concatenation as above.
// Does NOT create a story_recordings row and does NOT change kind. Owner + state='draft' gated.
appendTypedTakeContribution(db, input: {
  storyId: string; ownerPersonId: string; text: string; priorProse: string | null;
}): Promise<{ prose: string; appendedSegment: string }>

// FINISH: seal composition. finalText = the client's final editor text. metadata already derived by
// the caller (pipeline.deriveMetadata) — core stays LM-free. If finalText !== current stories.prose,
// update prose + append human_corrected(finalText). Persist title/summary/tags. Transition
// draft → pending_approval (assertStoryTransition). Owner + state='draft' gated. NEVER clears prose.
finishDraft(db, input: {
  storyId: string; ownerPersonId: string; finalText: string;
  metadata: { title: string; summary: string; tags: string[] };
}): Promise<Story>

// Log a manual Polish tap. Appends ai_polished(polishedProse) AND updates stories.prose. Owner-gated;
// allowed in state 'draft' (composing) AND 'pending_approval' (light review). Reversible in the UI via
// useProseHistory; the ledger row is permanent (every tap logged, ADR-0014 §2). LM ran in the caller.
logPolish(db, input: {
  storyId: string; ownerPersonId: string; polishedProse: string;
  modelId: string; promptText: string;
}): Promise<Story>
```

`appendProseRevisionInput` gains `storyRecordingId?: string` (see §2). `saveProseCorrection` stays as
the `pending_approval` hand-edit snapshot path (unchanged). No content read/write path is added outside
`story-repository.ts`; **no ALLOWLIST edit** is required (all new fns live in the already-allowed file).

**Regeneration guard (ADR-0014 §7, confirmed in-scope for Inc 2):** add an assertion/guard so no core
path sets `stories.prose = NULL` on a story that has any `user_authored` or `human_corrected` lineage
row (authored content must never be blindly regenerated). Ships with a regression test.

---

## 5. Pipeline seam signatures (Inc 1 — pure functions in `packages/pipeline/src`)

Both are pure LM functions (mockable via `ScriptedLanguageModel`); they persist nothing.

```ts
// Per-take Cleanup: the AUTOMATIC light pass over ONE take's raw transcript. Filler/false-starts/
// within-take self-corrections; order-preserving; keeps genuine hedges; NEVER reorders, NEVER sees
// other takes. Segment in → cleaned segment out. Distinct from polishProse (the stronger holistic
// manual pass) — Cleanup is lighter and single-take. Empty transcript → empty prose no-op.
cleanupTake(llm: LanguageModel, input: {
  transcript: string; promptQuestion?: string; narratorSpokenName?: string;
}): Promise<{ prose: string; modelId: string; systemPrompt: string }>

// Metadata derivation over the WHOLE final composed text, at Finish. title/summary/tags only.
// era is DEFERRED (CONTEXT.md Timeline: eraYear inference is a deferred extraction; v1 uses supplied
// era) — do NOT derive eraYear here. Reuses/adapts the metadata half of the current render prompt.
deriveMetadata(llm: LanguageModel, input: {
  fullText: string; promptQuestion?: string; narratorSpokenName?: string;
}): Promise<{ title: string; summary: string; tags: string[]; modelId: string; systemPrompt: string }>
```

Inc 1 extracts these from today's monolithic `renderStoryFromTranscript` (which produces prose+metadata
in one JSON call). `renderStoryFromTranscript` and the old orchestrator/multi-take render path **stay
in place for now** (Inc 3 swaps the web over and retires them); Inc 1 only *adds* the two new seams
+ unit tests. `cleanupTake` runs **synchronously in the capture action** (precedent:
`transcribeTakeToRecording`); `deriveMetadata` runs **synchronously in the Finish action** (one short
call — avoids the durable-hop latency that caused the 2026-07-03 "hang"). The durable Inngest queue is
reserved for background work (memory extraction, any heavy/optional pass).

---

## 6. Capture-action orchestration (Inc 3 — how the seams compose)

Per voice take (synchronous, in the server action):
1. `capture.ingestRecording` (take 0) / `ingestFollowUpTake` (take N) → media + `story_recordings` row.
2. `multi-take.transcribeTakeToRecording(rt, storyRecordingId)` → raw transcript on the take.
3. `pipeline.cleanupTake(llm, { transcript, promptQuestion?, narratorSpokenName? })` → cleaned segment.
4. `core.appendVoiceTakeContribution({ …, rawTranscript, cleanedSegment, priorProse: clientEditorText })`.
5. Return `{ appendedSegment, prose }`; client appends via `useProseHistory.replace` (undoable), never
   clobbering in-progress hand-edits (server concatenated onto the client's current text in step 4).

Per typed take: `core.appendTypedTakeContribution({ …, text, priorProse: clientEditorText })` → return.

Finish action: `pipeline.deriveMetadata(llm, { fullText })` → `core.finishDraft({ …, finalText, metadata })`
→ `pending_approval`. (Finish check — detect unresolved cross-take self-corrections and offer a Polish —
is an Inc 3 concern layered before `finishDraft`; accepting runs `logPolish`.)

Manual ✨ Polish tap: `pipeline.polishProse(llm, …)` (exists) → `core.logPolish({ …, polishedProse })`.

---

## 7. Sequencing

Contract frozen (this doc) → **Inc 2** (schema FK + kind invariant + media guard + core write fns +
regeneration guard) → **Inc 1** (cleanupTake + deriveMetadata seams) → **Inc 3** (web composing surface,
wires 1+2) ∥ **Inc 4** (intake, needs 2 + Inc 3's shared editor) → **Inc 5** (observability + doc-true).
Inc 1 and Inc 2 touch disjoint packages and could parallelize; we sequence them on the shared branch to
avoid git-index races. Each increment runs the repo subagent workflow (implementer + spec review + code
review) and ends `pnpm -r test` + `pnpm -r typecheck` green.
