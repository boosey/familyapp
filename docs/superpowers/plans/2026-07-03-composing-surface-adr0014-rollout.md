# ADR-0014 Composing Surface — Rollout Roadmap

> **For agentic workers:** This is the **decomposition** of ADR-0014 into a shared-contract-first
> sequence of increments. Each increment is a shippable, testable slice with its **own** detailed
> bite-sized plan, written **just-in-time** right before it is built (later increments' task details
> depend on how earlier ones land). REQUIRED SUB-SKILL to execute each increment:
> `superpowers:subagent-driven-development` (a fresh coding subagent per task + a fresh adversarial
> reviewer per the repo's CLAUDE.md workflow).

**Goal:** Turn ADR-0014 (the live `DRAFT` composing surface, the four text passes, authored prose,
voice/text interleave, the Finish check, and consent-gated memory extraction) into shipped code,
without breaking the load-bearing single-front-door, the consent ledger, or the deployed beta.

**Architecture:** Shared contract (provenance vocabulary + core write-path shape) lands first and
blocking; pipeline and core changes next; the web composing surface and intake unification parallelize
on top; observability and doc-truing last. Schema changes ride the **reseed workflow** (no incremental
migration) and require **reseeding both Neon branches** (dev + production) behind the schema-parity
deploy gate.

**Tech stack:** pnpm workspaces monorepo, TS strict ESM, Drizzle + PGlite (tests) / Neon (prod),
Vitest, Next.js 15 / React 19, Inngest (durable queue), Groq/Anthropic (vendor seams).

**Source of truth for the design:** `docs/adr/0014-*`, `docs/Capture-State-Machines.md`, and the
`CONTEXT.md` glossary (Draft, the four text operations, the pass-scope invariant, source-of-truth vs.
audio-of-record, Intake, Memory extraction).

---

## Sequencing & dependency graph

```
Inc 0 (provenance + core contract)  ──blocking──┐
        │                                       │
        ▼                                       ▼
Inc 1 (pipeline: split + sync per-take)   Inc 2 (core write path + kind invariant)
        │                                       │
        └───────────────┬───────────────────────┘
                        ▼
             Inc 3 (web composing surface)  ──┐
                        │                      │
                        ▼                      ▼
             Inc 4 (intake unify + memory)   (Inc 3 & 4 parallelize)
                        │
                        ▼
             Inc 5 (observability + doc-true + ADR close)
```

**Shared-contract-first rule (repo CLAUDE.md):** Inc 0 defines the provenance enum values and the
core function signatures that every later increment consumes. It must land and be green before Inc 1/2
start, and Inc 3/4 must not begin until Inc 1/2's contract is stable.

---

## Increment 0 — Provenance vocabulary + core contract (BLOCKING)

**Goal:** Rename the enum so names match the design, and pin the function signatures later increments
call. Smallest possible change that unblocks everything.

**Subsystems / files:**
- `packages/db/src/schema.ts` — `proseRevisionLevelEnum` (line ~143): rename value
  `"ai_polished"` → `"ai_cleaned"`; **add** a new `"ai_polished"` (the manual button's level). Final
  set: `ai_transcribed, ai_cleaned, ai_polished, human_corrected, ai_verified(reserved), user_authored`.
- `packages/pipeline/src/orchestrator.ts` — the render stage's L2 append currently uses
  `level: "ai_polished"`; change to `"ai_cleaned"` (it *is* the automatic Cleanup pass).
- `packages/db/test/prose-revisions.test.ts` + `packages/pipeline/test/*` — enum round-trip + the
  render stage appends `ai_cleaned`.
- Reseed: `pnpm --filter @chronicle/db db:generate` → reseed dev; then **both Neon branches**
  reseeded (schema-parity deploy gate).

**Key decisions to resolve in the detailed plan:**
- Enum-rename mechanics under the no-incremental-migration model: because dev/prod reseed from
  `schema.ts`, a rename is just an edit + reseed (no `ALTER TYPE ... RENAME VALUE`). Confirm no data
  needs preserving (no users) — the [[project_single_schema_no_migrations]] memory says reseed blows
  the DB away, so this is safe.
- Whether to keep `ai_verified` reserved (yes — leave it).

**Test focus:** enum values round-trip; a rendered voice draft carries `ai_transcribed` + `ai_cleaned`
(not `ai_polished`); no code still writes the old `ai_polished` meaning.

**Depends on:** nothing. **Blocks:** all.

---

## Increment 1 — Pipeline: split render, synchronous per-take Cleanup

**Goal:** Replace the monolithic on-stop `transcribe → render → pending_approval` with **per-take
Transcription + Cleanup that runs synchronously** (fast enough for an interactive loop, per the ADR's
open-latency note) and defer metadata to Finish.

**Subsystems / files:**
- `packages/pipeline/src/orchestrator.ts` — split `runRenderStoryStage`: extract a **Cleanup**
  operation (per take, appends `ai_cleaned`, no state transition, no title/summary/tags) from the
  metadata derivation. Text takes skip Transcription+Cleanup (already the `kind==='text'` branch).
- `packages/pipeline/src/render-story.ts` — separate the disfluency-clean prompt (Cleanup, per-take
  input) from the metadata prompt (title/summary/tags/era over the *whole* final text). May become two
  functions: `cleanupTake(transcript)` and `deriveMetadata(fullText)`.
- `apps/web/lib/dispatch-pipeline.ts` — add a **synchronous per-take** path (Cleanup runs inline in the
  capture action and returns the cleaned text) distinct from the durable path used for heavier/finish
  work. The dev/CI synchronous path is the model.
- Tests: `packages/pipeline/test/*` — per-take Cleanup output; metadata derived only at Finish; text
  take path; idempotency/provenance (`ai_cleaned` per take, no duplicate rows).

**Key decisions to resolve in the detailed plan:**
- Stage taxonomy: is Cleanup a new named `JobName`, or an inline call in the capture action that
  bypasses the queue entirely for the interactive per-take turnaround? (Leaning: **inline in the
  action** for per-take; durable queue reserved for at-Finish metadata + memory extraction.)
- Where the raw per-take `transcript` and per-take `ai_transcribed`/`ai_cleaned` rows are keyed
  (per-take index vs. story-level) — must line up with Inc 2's take model.

**Depends on:** Inc 0. **Blocks:** Inc 3.

---

## Increment 2 — Core write path: editable draft, append, Finish; the kind invariant

**Goal:** The core (audited front-door) surface for a live draft: hold editable transcript+prose,
append a take, run Finish (derive metadata, snapshot `human_corrected` if changed, transition
`draft → pending_approval`), and fix the kind/recording invariant for mixed drafts.

**Subsystems / files:**
- `packages/core/src/story-repository.ts` — extend the audited write path: append-take (voice/typed),
  a `finishDraft(storyId, finalText)` that derives+persists metadata, snapshots `human_corrected`,
  and transitions state; keep `saveProseCorrection` for the snapshot. `polishProse` logging entry
  (append `ai_polished`) — see Inc 3 for the web wiring, but the **core append fn** lands here.
- `packages/db/drizzle/invariants.sql` — the `stories_kind_recording_ck` CHECK (line 167) assumes
  take-0 `recording_media_id` defines kind. A **mixed** draft (typed take 0, voice take later) breaks
  it. **Move the "voice ⇒ has audio" half to a trigger** that checks `story_recordings` (a CHECK
  can't cross tables), keeping only `text ⇒ no recording` as a CHECK. Coordinate with the existing
  `chronicle_story_recording_pointer_immutable` trigger.
- Tests: `packages/core/test/*`, `packages/db/test/*` — append-take, Finish transition + metadata +
  correction snapshot, mixed-kind accepted, `text`-with-audio still rejected.

**Key decisions to resolve in the detailed plan:**
- **`recording_media_id` fate:** keep as the "first voice take" pointer (immutable trigger already
  guards it) or derive kind purely from `story_recordings`. Recommend: keep the pointer for the first
  *voice* take; a mixed draft whose first take is typed has a null pointer but ≥1 `story_recordings`
  row ⇒ still `voice`. The kind trigger enforces "voice ⇔ ≥1 story_recording".
- **Regeneration-contract fix:** ensure no path clears `prose` to regenerate (it's authored now). Add
  a guard/assertion + remove the "clear prose to re-render" idempotency escape from the metadata path.

**Depends on:** Inc 0. **Blocks:** Inc 3, Inc 4.

---

## Increment 3 — Web composing surface (`StoryComposer` rework)

**Goal:** The user-facing change: `StoryComposer` becomes a live `DRAFT` surface — record **or type**
interleaved, append shows the appended cleaned segment, ✨ Polish logs `ai_polished`, a **Finish**
button runs the Finish check then the light `pending_approval` (title+tier+Share) screen. Removes the
"Polishing your words" auto-render gate.

**Subsystems / files:**
- `apps/web/app/hub/StoryComposer.tsx` — the big rework: editor lives in the draft phase; live
  mic+keyboard; append a take (calls Inc 1 sync Cleanup, appends to editor as an undoable entry);
  `KindredProseEditor` already has undo/redo + `onPolish` (reuse). Remove the `AnswerReviewPending`
  "Polishing your words" poll gate for the initial capture.
- `apps/web/app/hub/answer/[askId]/actions.ts` — `polishAnswerProseAction`/`polishStoryProseAction`
  must take `storyId` and append `ai_polished` (Inc 2 core fn); new `finishDraftAction` (runs Finish
  check → metadata → pending_approval); `composeStoryAction` returns the draft to the editor rather
  than polling to review.
- New: the **Finish check** UI (detect-and-offer): a server call that scans for unresolved
  self-corrections and returns an offer; accept → a logged Polish.
- Tests: `apps/web/__tests__/*` — record/type/mix/append; polish logs a row; Finish check offer +
  accept/decline; Finish → pending_approval → share; regression on the existing composer suite.

**Key decisions to resolve in the detailed plan:**
- Editor state reconciliation: the editor's local text vs. the server's appended cleaned segment on
  each take (append must not clobber in-progress hand-edits — the undo-history `replace` semantics in
  `useProseHistory` are the tool).
- Finish-check UX: modal vs. inline; how the preview/diff is shown.

**Depends on:** Inc 1, Inc 2. **Parallel with:** Inc 4.

---

## Increment 4 — Intake unification + memory-extraction placement

**Goal:** Intake rides the same composing surface (append + Cleanup + ✨ Polish + Finish check) but
stops at anchor extraction; wire consent-gated memory extraction across all modes.

**Subsystems / files:**
- `apps/web/app/hub/about-you/AboutYouFlow.tsx` + `actions.ts` — reuse the shared composing editor
  (append, Cleanup, Polish) instead of the raw-transcript textarea; extraction runs at **Save**;
  intake audio+transcript retained (already the direction).
- Memory extraction: confirm `augmentProfileFromStory` fires **post-approval only** for stories (it
  already does — S4); intake extracts at Save. Add the (deferred-model) narrator-memory seam call
  site as a no-op/stub so the placement is real and future-ready.
- Tests: intake append/polish/finish-check; memory extraction gating (discarded draft never feeds).

**Key decisions to resolve in the detailed plan:**
- Reuse `StoryComposer` directly (with an `intake` mode) vs. a shared `<ComposingEditor>` sub-component
  both surfaces mount. (Leaning: extract the shared editor sub-component; intake and story compose it.)

**Depends on:** Inc 2 (+ Inc 3's shared editor component). **Parallel with:** Inc 3.

---

## Increment 5 — Observability, doc-truing, ADR close

**Goal:** Make the sequence debuggable and true up the docs.

**Subsystems / files:**
- Verbose **client + server** logging across record/type/edit/polish/finish (server via existing
  `plog`; add client-side `[chronicle]` console logging for the capture state transitions the live
  test lacked). Confirm the prod toggle (`CHRONICLE_PIPELINE_LOG=1`) surfaces the whole sequence.
- `docs/Recording-To-Story-Pipeline.md` — rewrite to the new flow (remove the "current shipped"
  banner once this lands).
- `docs/adr/0014-*` — Status → Implemented; add implementation notes. `docs/adr/0007-*` — note the
  "canonical = original record" amendment. `docs/PLAN.md` / `PROGRESS.md` updated.
- Retire the "Polishing your words" copy (`_copy/hub.ts`).

**Depends on:** Inc 3, Inc 4.

---

## Cross-cutting guardrails (every increment)

- **Single front door:** any new content read/write path added to `story-repository.ts` must stay on
  the architecture-test ALLOWLIST; never import `@chronicle/db/content` elsewhere.
- **Reseed, don't migrate:** schema edits go `schema.ts → db:generate → reseed`; **both Neon branches**
  reseed before deploy (schema-parity gate). See [[project_single_schema_no_migrations]],
  [[project_neon_schema_drift_bootstrap_only]].
- **Regression test after every bug fix** (repo CLAUDE.md).
- **Fresh adversarial reviewer per task** (repo CLAUDE.md subagent workflow).
- **Vercel git-author gate:** commit as `boosey.boudreaux@gmail.com` or deploys are blocked
  ([[project_vercel_git_author_gate]]).

## Self-review coverage check (spec → increment)

| ADR-0014 decision | Increment |
|---|---|
| §1 editor in DRAFT; Finish ≠ Share | Inc 2 (transition), Inc 3 (UI) |
| §2 four ops + enum rename + log every Polish | Inc 0 (enum), Inc 2 (core append), Inc 3 (web wiring) |
| §3 pass-scope invariant | Inc 1 (per-take Cleanup), Inc 3 (Polish button) |
| §4 append never re-render | Inc 1 (per-take), Inc 3 (editor append) |
| §5 Finish check | Inc 3 |
| §6 voice/text interleave; any-audio⇒voice | Inc 2 (kind invariant), Inc 3 (mixed capture) |
| §7 authored prose; regeneration lossy | Inc 2 (regeneration guard) |
| §8 intake shares interaction not authoring | Inc 4 |
| §9 memory extraction consent-gated | Inc 4 |
| open: synchronous per-take latency | Inc 1 |
| observability / doc-true | Inc 5 |
