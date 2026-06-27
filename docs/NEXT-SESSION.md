# Continuation Prompt — Next Session

Paste the prompt block below into a fresh Claude Code session. It is self-contained.

---

## Prompt to paste

You are the lead engineer continuing the Phase 0 + Phase 1 build of "Family
Chronicle", an AI-first family-storytelling product. Resume an in-progress
build — do NOT restart.

### Read these first (in order)
1. `CLAUDE.md` (repo root) — short orientation written for fresh sessions
2. `docs/Phase-0-1-Engineering-Spec.md` — source of truth (read in full)
3. `docs/PLAN.md` — 7-increment checklist with progress
4. `docs/PROGRESS.md` — eval status/log per increment
5. `docs/DECISIONS.md` — every non-obvious choice already made + why
   (READ the I1 / I2 / I3 / I4 review-response sections; do NOT re-litigate them)
6. `docs/OPEN-QUESTIONS.md` — stubs + acknowledged Phase-1 gaps (not violations)

### Operating mandate (unchanged)
Own the implementation; make engineering decisions yourself without asking,
except (1) a spec ambiguity with materially different hard-to-reverse
architectures, or (2) anything requiring real-world action (paid accounts,
vendor signup, real personal data, cost) — stub those and note in
OPEN-QUESTIONS. Honor the LOCKED decisions + 3 principles as inviolable
(elder never feels they use software; authenticity beats polish / original
audio canonical and never overwritten; consent owned by the person, enforced
at the data layer).

For EACH increment run the loop: BUILD (code + real asserting tests) →
spawn a FRESH adversarial sub-agent reviewer (give it ONLY the spec + the
files you wrote + a review checklist; it reports spec violations with
file:line, fixes nothing) → ENHANCE → re-eval with a NEW fresh sub-agent
until it returns no spec violations → next increment. Keep
PLAN/PROGRESS/DECISIONS/OPEN-QUESTIONS updated. Commit locally per
increment (no push). Use the general-purpose agent for reviewers.

**Build the remaining increments SEQUENTIALLY (I5 → I6 → I7). No
parallelism.** The interviewer (I4) is now in place and the approval gate
(I5) is the next thing the rest of the build leans on; doing it solo with
full attention is the right call. Same for I6 (depends on I5 output) and
I7 (depends on I4 + I6).

Commit messages end with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

### Environment
- Repo IS on local disk (`C:\Users\boose\projects\familyapp`) — not Google Drive.
- pnpm install is clean; PGlite + Vitest stable.
- DO NOT run `next build` or `next dev` until the user explicitly asks. For
  web verification use `pnpm -F @chronicle/web exec tsc --noEmit`.
- `cd` does NOT persist between Bash tool calls — use `pnpm -F <pkg> exec ...`
  from the repo root, or pass absolute paths.

### State of the build (HEAD = `e5e758b`)
- Increment 0 (scaffold): ✅ done
- Increment 1 (THE SPINE): ✅ done, eval-clean (3 rounds)
- Increment 2 (CAPTURE PATH): ✅ done, eval-clean (2 rounds)
- Increment 3 (PIPELINE): ✅ done, eval-clean (3 rounds)
- **Increment 4 (INTERVIEWER): ✅ done, eval-clean (3 rounds)**
  - New `@chronicle/interviewer` package: controlled turn loop wrapping
    `LanguageModel` (NOT an open chat). Seams: `Voice` (TTS for question
    audio — ElevenLabs default), `AskSource` (I7 plugs DB-backed asks),
    `MemorySource`, `AnchorSource`. Mocks: `ScriptedVoice`,
    `InMemoryAskSource`, `InMemoryMemorySource`, `InMemoryAnchorSource`.
  - Behavior policy (`behavior.ts`) priority: distress → off-ramp →
    callback-on-turn-0 → pending Asks (by priority) → follow_up → base
    bank. High-sensitivity rapport-gated (`RAPPORT_THRESHOLD_TURNS = 4`);
    distress flag suppresses high even past rapport. Reminiscence-bump
    (childhood / young_adult) phases preferred. Off-ramp ≠ distress —
    only distress flags `surfaceHumanSupport`. `follow_up` clears
    `lastElderUtterance` on consumption (no sticky re-fire).
  - Phraser (`phraser.ts`) is the ONLY LLM call; in-house system prompt
    embeds the spec's absolute rules (one thing at a time, open-ended,
    never invent facts, never push, anchors-as-hints).
  - Cross-session memory uses NEW audited content read
    `listElderMemoryForInterviewer` in `story-repository.ts`. SQL projects
    only `title/summary/tags/promptQuestion/createdAt` — transcript /
    prose / storageKey never selected. Architecture allowlist UNCHANGED
    (exact-membership canary still pins `authorization.ts` +
    `story-repository.ts`).
  - Vendor-SDK guard now scans `packages/interviewer/src` too.
  - 111 tests green (db 11, storage 11, core 34, capture 11, pipeline 20,
    interviewer 24). All packages + apps/web typecheck clean.

### Two architecture allowlists are in force (both exact-membership)
- Content tables (`@chronicle/db/content`): exactly `authorization.ts` +
  `story-repository.ts`.
- Pipeline system-actor read (`@chronicle/core/pipeline`): exactly
  `packages/pipeline/src/orchestrator.ts`.

Any new audited file must be added to the appropriate ALLOWLIST in
`packages/core/test/architecture.test.ts` in the SAME commit. The two
existing allowlists are exact-membership canaries — extending them is a
deliberate, reviewer-visible event.

### DO THIS NEXT — Increment 5 (then I6, then I7) — sequentially

Per `PLAN.md` / spec Part III.

**Increment 5 — VOICE-ONLY APPROVAL GATE**
- Voice approval IN-SESSION; capture `approval_audio` Media (different
  `kind` from `story_audio`, already in the schema enum) via the same
  storage-first ordering pattern as `ingestRecording` (audio bytes in
  storage BEFORE the DB row, so authenticity beats polish if anything
  fails).
- ATOMIC transition: `pending_approval → approved → shared` at the
  elder's chosen `audienceTier`, AND the first `ConsentRecord`
  (`action=approved_for_sharing`, points at the approval-audio Media) —
  in **one `db.transaction`**. Build a new audited write function in
  `packages/core/src/story-repository.ts` (file is already on the
  allowlist; no new entry needed). It should call `transitionStoryState`
  twice (pending_approval → approved, then approved → shared) and
  `recordConsent` once, all within the same transaction.
- Voice correction regenerates **prose only** (call into
  `renderStoryFromTranscript` again with the corrected transcript);
  audio untouched, canonical bytes still primary.
- Authorization function already refuses to surface a Story without
  approved/shared state + backing `approved_for_sharing` ledger row.
  Add regression tests that exercise the full approval flow end-to-end:
  before approval → invisible to family; after approval → visible at the
  chosen tier; after a `revoked` superseding row → invisible again.
- Touches `@chronicle/capture` (approval capture path uses the same
  `CapturedAudio` / `ingestRecording`-style helper) +
  `@chronicle/core` (the new audited write + tests).

**Increment 6 — BASIC FAMILY HUB** (after I5)
- Logged-in younger-gen `apps/web` surface; approved-stories list
  (original voice primary, prose secondary); invite-link generator
  (creates `elder_session`); Ask submission form.
- AuthProvider seam stubbed (Clerk in prod per DECISIONS).
- All reads strictly through `@chronicle/core`'s authorization function.

**Increment 7 — ASKED-QUESTION RELAY** (after I6)
- Ask queued → routed into the interviewer queue (one of several prompt
  sources = seam already shaped by `@chronicle/interviewer`'s
  `AskSource`).
- Prioritize + frame warmly with asker named; buffered, never interrupts
  elder.
- On approval flip Ask to `answered` with Story pointer + notify asker
  (hub notification).

### Front-door discipline reminder
Any new content read/write path goes through `@chronicle/core` and is
added to the appropriate ALLOWLIST in
`packages/core/test/architecture.test.ts` in the same commit. Both
existing allowlists are exact-membership canaries — quiet widening is
not possible.

### Conventions reminder
- TS strict + `noUncheckedIndexedAccess`; ESM only; `verbatimModuleSyntax`.
- Pure source packages (`main = ./src/index.ts`), `workspace:*` deps.
- Vendor SDKs only in adapter files; the architecture test in
  `packages/pipeline/test/pipeline.test.ts` enforces zero vendor SDK
  imports in `@chronicle/{core,db,storage,capture,pipeline,interviewer}`.
  When you add another IP package (none planned for I5–I7), add it to
  that scan.
- Global preferences (`~/.claude/CLAUDE.md`): regression test after bug
  fix; act adversarial; remember corrections (per-project here).
- Memory at
  `C:\Users\boose\.claude\projects\C--Users-boose-projects-familyapp\memory\`.
  Read `MEMORY.md` early. One feedback memory: always provide a
  continuation prompt when suggesting clean context.

Begin with reading the spec + PLAN/PROGRESS/DECISIONS/OPEN-QUESTIONS,
then state the I5 plan in 3-5 lines and start building. Sequential —
I5 → I6 → I7 — no parallelism.
