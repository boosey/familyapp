# Prose Provenance & Human Correction — Design

**Date:** 2026-06-29
**Status:** Approved (design); implementation plan to follow.
**Supersedes the working title "faithfulness step."** Through brainstorming, the automated
LLM faithfulness *judge* was dropped in favor of human-in-the-loop correction plus a 3-level
provenance record. The human edit *is* the faithfulness mechanism; the AI-polished → human-corrected
diff is the empirical signal for improving prompts and comparing models.

---

## 1. Problem & intent

The render stage (`@chronicle/pipeline/render-story.ts`) cleans a transcript into prose under a
strict "preserve the speaker's words, don't embellish, don't add facts, don't sound like AI" policy.
That policy is asserted in a prompt but never *verified*, and we keep no record of where the AI
diverged from what the narrator actually meant.

We want two things:

1. **A human correction step.** After the AI's single pass, the narrator (or, in the hub, the
   account holder) reads the polished prose, edits it directly in a multiline editor, then approves
   and shares. No second trip through the model.
2. **A durable, queryable record of three prose levels** so we can continually improve prompts and
   decide between models:
   - **L1 `ai_transcribed`** — raw speech-to-text.
   - **L2 `ai_polished`** — the rendered/cleaned prose.
   - **L3 `human_corrected`** — the narrator's edit (only when they actually edit).

   The **L2 → L3 diff** is the quality signal. To interpret it we must also record **which model**
   and **which prompt** produced each AI level — prompts change over time.

### Explicitly NOT in scope

- **No automated LLM faithfulness judge / AI verification step.** Considered and deferred as
  overkill. A future `ai_verified` enum value can slot in with no schema change if the data later
  justifies it.
- **No AI regeneration loop.** AI runs exactly once (transcribe, then polish). Corrections are
  human-only and never re-rendered.
- **`applyVoiceCorrection` is NOT wired in.** It corrects the *transcript* and re-renders via the
  LLM — exactly the loop being rejected. It stays dormant. A new direct prose-save path replaces it
  for this flow.
- **Richer biographical fact-extraction ("a picture of the person")** is a separate feature needing
  its own design session. Parked in `docs/OPEN-QUESTIONS.md`.

---

## 2. Canonical flow (after this change)

```
record audio
   │
   ▼
ingest → DRAFT story                                   (unchanged)
   │
   ▼
PIPELINE — now runs BEFORE review:
   transcribe → append L1 (ai_transcribed)
   render     → set stories.prose = L2, append L2 (ai_polished)
              → transition DRAFT → PENDING_APPROVAL
   (future seam: ai_verified would sit here)
   │
   ▼
REVIEW step (narrator / account holder):
   relisten audio · READ + EDIT prose in a multiline editor · pick audience tier
   │
   ▼
APPROVE & SHARE:
   if prose edited → saveProseCorrection (set stories.prose = L3, append L3 human_corrected)
   → approveAndShareStory (consent ledger)             (unchanged)
   → augmentProfileFromStory (best-effort)             (unchanged)
```

**Key ordering change:** render moves from *after Share* to *after ingest*, so the polished prose
exists at review time. The LLM latency relocates from the Share tap to the record→review transition.

---

## 3. Data model — `prose_revisions` (append-only)

Mirrors `consent_records`: append-only, enforced at two layers (Postgres trigger + repository that
exposes only append + read).

| column          | type                              | notes                                                        |
|-----------------|-----------------------------------|--------------------------------------------------------------|
| `id`            | uuid pk                           |                                                              |
| `storyId`       | fk → stories                      |                                                              |
| `level`         | enum `prose_revision_level`       | descriptive values below                                     |
| `text`          | text                              | the prose at that stage                                      |
| `modelId`       | text nullable                     | AI model that produced it; `null` for human                  |
| `promptText`    | text nullable                     | exact prompt used; `null` for `ai_transcribed` and human     |
| `actorPersonId` | fk nullable                       | set for `human_corrected` (who edited)                       |
| `createdAt`     | timestamptz                       | ordering / analytics                                         |

**Enum `prose_revision_level`** (descriptive; room to grow):
`ai_transcribed`, `ai_polished`, `human_corrected` — and a reserved future `ai_verified`.

- `ai_transcribed`: `modelId` = transcriber id, `promptText` = null (STT has no prompt).
- `ai_polished`: `modelId` = render LLM id, `promptText` = the render `SYSTEM_PROMPT` used.
- `human_corrected`: `modelId`/`promptText` null, `actorPersonId` set.

**Generation config note:** `modelId` + `promptText` capture model and prompt. `temperature`/
`maxOutputTokens` are the remaining tuning variables; deliberately **not** stored in v1 (only the
prompt was requested). If full reproducibility is wanted later, fold them into a `genConfig jsonb`
rather than adding columns piecemeal.

**Storage note:** full prompt text repeats across many rows. Acceptable for now; can normalize to a
hashed `prompts` table later if storage matters. Not doing that now.

**Where prose lives:** `stories.prose` remains the single viewer-facing field returned by
`getStoryForViewer`. It holds the *current* working/final text — set to L2 when render completes,
overwritten with L3 on human correction. `prose_revisions` is the immutable lineage beside it.

---

## 4. Seams

### `@chronicle/db`
- `schema.ts`: add `prose_revisions` table + `prose_revision_level` pgEnum. Re-export the row type
  and enum as the shared contract.
- `invariants.sql`: trigger rejecting UPDATE/DELETE on `prose_revisions` (copy the
  `consent_records` guard).
- Single-schema dev workflow: edit `schema.ts` → `db:generate` → reseed (`resetSchema` +
  `schema.sql` + `invariants.sql`). No incremental migration.

### `@chronicle/core` (`story-repository.ts`, already on the architecture allowlist)
- `appendProseRevision(db, {storyId, level, text, modelId?, promptText?, actorPersonId?})` —
  append-only write.
- `saveProseCorrection(db, {storyId, correctedProse, actorPersonId})` — sets `stories.prose = L3`,
  appends a `human_corrected` revision; **gated to `pending_approval` + owner**. Replaces
  `applyVoiceCorrection` for this flow (no LLM round-trip). No-op semantics if prose is unchanged is
  decided at the call site (only called when the editor value differs from L2).
- `listProseRevisions(db, storyId)` — internal/training read returning raw prose content.
  **Architecture note:** this exposes prose content. It lives in the already-allowlisted
  `story-repository.ts` and is **analytics/offline-tooling only** — no family-facing surface calls
  it. Documented as a deliberate, narrow addition to the audited surface.

### `@chronicle/pipeline` (`orchestrator.ts`)
- transcribe stage: after persisting transcript, `appendProseRevision(ai_transcribed,
  transcriberModelId)`. Thread the transcriber `modelId` through (currently dropped).
- render stage: persist `prose = L2`, `appendProseRevision(ai_polished, renderModelId, promptText)`,
  transition → `pending_approval`. Thread the render `modelId` and the `SYSTEM_PROMPT` through.
- **Idempotency:** transcribe/render are already idempotent (skip when output exists). The appends
  must inherit that — only append when the stage actually produced output this run, never on the
  skip path, so re-runs don't create duplicate rows.

### `@chronicle/web`
- **Shared `ProseEditor`** component (multiline textarea, Kindred chrome), prefilled with L2, used by
  both surfaces.
- **In-hub** (`hub/answer/[askId]/AnswerFlow.tsx`, `actions.ts`, `page.tsx`):
  - `recordAnswerAction` runs **ingest → pipeline** inline; review phase then has L2. The voice
    button's "saving" state extends to cover the LLM round-trip ("preparing your story…").
  - Review phase adds the `ProseEditor` (prefilled L2) above the tier picker; relisten stays.
  - `shareAnswerAction`: if prose changed → `saveProseCorrection` (L3) → `approveAndShareStory` →
    augment. The pipeline call is **removed** here (it moved to record).
  - `page.tsx` passes `prose` (L2) into `AnswerFlow`.
- **Link-session** (`s/[token]/approve/[storyId]/page.tsx`, `ApprovalRecorder.tsx`,
  `api/capture/approve/route.ts`):
  - Page already renders before landing → add the `ProseEditor` (prefilled L2) above the voice
    `ApprovalRecorder`. Approval stays voice; editing is additive.
  - Edited prose rides along with the voice-approval submission. Route calls `saveProseCorrection`
    (while still `pending_approval`) → then `captureApproval` (voice clip + consent).
- **L3 only written on approve.** Edits abandoned via re-record/discard never create a
  `human_corrected` row. "No edit" is itself signal (the polish needed no correction).

---

## 5. Error handling

- **Pipeline failure at record→review** (e.g. LLM down): soft-fail, story stays `draft`, narrator
  retries. Same softfail UX as today, relocated to the record→review transition.
- **`saveProseCorrection` failure on approve:** block the share, surface an error. Never share stale
  prose while pretending the edit took.
- **Append-only violations:** thrown errors (tested).

---

## 6. Testing (TDD)

- **db:** PGlite test that UPDATE/DELETE on `prose_revisions` is rejected by the trigger.
- **core:** `appendProseRevision`; `saveProseCorrection` gating (owner-only, `pending_approval`-only,
  sets `prose` + appends `human_corrected`); `listProseRevisions` ordering + content.
- **pipeline:** render/transcribe append `ai_transcribed` + `ai_polished` with correct
  `modelId`/`promptText`; **idempotent re-run appends no duplicate rows.**
- **architecture test:** confirm the scan still passes with `listProseRevisions` reading prose
  content from `story-repository.ts`; document the allowlist intent.
- **web:** reordered in-hub flow; link-session edit→approve path.
- **regression test** companion for the reorder (sharing-before-render is the failure mode being
  prevented).

---

## 7. The no-AI-phase reality

Until the real Groq/Anthropic adapters are exercised end-to-end, L2 is mock prose and `modelId` is a
mock id — but `promptText` records the *real* `SYSTEM_PROMPT`, and the editor + provenance + L2→L3
capture all work against mocks. The UI is fully exercisable now; only the *semantic quality* of L2 is
placeholder. The training data becomes meaningful the day real adapters ship.

---

## 8. Open / deferred

- **AI verify step (`ai_verified`)** — deferred; seam left in the enum.
- **`genConfig` (temperature, max tokens)** — not stored in v1.
- **Prompt-text normalization** (hashed `prompts` table) — deferred storage optimization.
- **Richer biographical "picture of the person" extraction** — separate design session (see
  `docs/OPEN-QUESTIONS.md`).
- **Title/summary/tags editing** — v1 edits prose only; title/summary/tags remain AI-derived.
