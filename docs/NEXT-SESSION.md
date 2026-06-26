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
   (READ the I1 / I2 / I3 review-response sections; do NOT re-litigate them)
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

Commit messages end with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

### Environment
- Repo IS on local disk (`C:\Users\boose\projects\familyapp`) — not Google Drive.
- pnpm install is clean; PGlite + Vitest stable.
- DO NOT run `next build` or `next dev` until the user explicitly asks. For
  web verification use `pnpm -F @chronicle/web exec tsc --noEmit`.
- `cd` does NOT persist between Bash tool calls — use `pnpm -F <pkg> exec ...`
  from the repo root, or pass absolute paths.

### State of the build (latest)
- Increment 0 (scaffold): ✅ done
- Increment 1 (THE SPINE): ✅ done, eval-clean (3 rounds)
- Increment 2 (CAPTURE PATH): ✅ done, eval-clean (2 rounds)
- Increment 3 (PIPELINE): ✅ done, eval-clean (3 rounds)
- **Increment 4 (INTERVIEWER): ✅ done, eval-clean (3 rounds)**
  - New `@chronicle/interviewer` package: controlled turn loop wrapping
    `LanguageModel` (NOT an open chat). Seams: `Voice` (TTS for question
    audio — ElevenLabs default), `AskSource` (I7 plugs DB-backed asks),
    `MemorySource`, `AnchorSource`. Mocks: `ScriptedVoice`,
    `InMemoryAskSource`, etc.
  - Behavior policy (`behavior.ts`) priority: distress → off-ramp →
    callback-on-turn-0 → pending Asks (by priority) → follow_up → base
    bank. High-sensitivity rapport-gated; distress flag suppresses high
    even past rapport. Reminiscence-bump (childhood/young_adult) phases
    preferred.
  - Phraser (`phraser.ts`) is the ONLY LLM call; in-house system prompt
    embeds the spec's absolute rules; per-Intent user blocks named.
  - Cross-session memory uses NEW audited content read
    `listElderMemoryForInterviewer` in `story-repository.ts`. SQL projects
    only `title/summary/tags/promptQuestion/createdAt` — transcript/prose/
    storageKey never selected. Architecture allowlist UNCHANGED.
  - Vendor-SDK guard now scans `packages/interviewer/src` too.
  - 110 tests green (db 11, storage 11, core 34, capture 11, pipeline 20,
    interviewer 24). All packages + apps/web typecheck.
  - New `@chronicle/pipeline` package: `Transcriber`, `LanguageModel`,
    `JobQueue`, `WorkingCopyTransformer` contracts + mocks; in-process queue
    with dedupe + per-drain attempt cap; in-house speech-to-story prompt +
    defensive parser; orchestrator wiring `transcribe → render_story`.
  - `assertStoryTransition` is NOW wired (Increment-1 deferral closed). The
    only state-change site is `transitionStoryState` in
    `packages/core/src/story-repository.ts`.
  - **Two architecture allowlists are now in force**, both exact-membership:
    - Content tables (`@chronicle/db/content`): exactly
      `authorization.ts` + `story-repository.ts`.
    - Pipeline system-actor read (`@chronicle/core/pipeline`): exactly
      `packages/pipeline/src/orchestrator.ts`.
    Any new audited file must be added to the appropriate ALLOWLIST in
    `packages/core/test/architecture.test.ts` in the SAME commit.
  - Canonical audio bytes immutable + tested via checksum + mutation-resistance.
    Working copy is transient (no Media row, no storage blob).
  - Word timings persisted in 1x original time. Story stays `private` through
    `pending_approval` (no consent yet).
  - DSP is stubbed (`speedFactor: 1.0` honest passthrough). VAD trim,
    real time-stretch, Groq 10s-floor stitching deferred — documented in
    OPEN-QUESTIONS.
  - 84 tests green: db 11, core 31, capture 11, storage 11, pipeline 20.
    All packages + apps/web typecheck clean.

### DO THIS NEXT — Increment 5 (and then I6, I7)

Per `PLAN.md` / spec Part III. I4 is now eval-clean — start I5.

**Increment 5 — VOICE-ONLY APPROVAL GATE (the next thing)**
- Voice approval IN-SESSION; capture `approval_audio` Media (different
  `kind` from `story_audio`, already in the schema enum) via the same
  storage-first ordering pattern as `ingestRecording`.
- ATOMIC transition: `pending_approval → approved → shared` at the
  elder's chosen `audienceTier`, AND the first `ConsentRecord`
  (`action=approved_for_sharing`, points at the approval-audio Media) —
  in one transaction. Build a new audited write in
  `packages/core/src/story-repository.ts` (already on the allowlist; no
  new entry). It calls `transitionStoryState` twice and `recordConsent`
  once, in a single `db.transaction`.
- Voice correction regenerates **prose only** (call into
  `renderStoryFromTranscript` again); audio untouched.
- Authorization function already refuses to surface a Story without
  approved/shared + backing consent ledger row. Add regression tests
  exercising the full approval flow end-to-end.
- Touches `@chronicle/capture` (approval capture path) +
  `@chronicle/core` (the new audited write).

**LEFTOVER from earlier prompt — keep for reference:**

**Increment 4 — INTERVIEWER BEHAVIOR (DONE)**
- New `@chronicle/interviewer` package. The interviewer is a controlled turn
  loop wrapping `LanguageModel` (already defined in `@chronicle/pipeline`) —
  NOT an open chat. Behavior policy lives in our code; the LLM provides only
  language.
- Behavioral commitments (spec): open-ended/concrete/non-leading; one
  question at a time; silence-tolerant; reflect/follow tangents; gentle
  sequencing (easy first, sensitive only after rapport, never push into
  pain, surface human-support note where appropriate); weight toward the
  reminiscence bump (ages 10–30); cross-session memory + warm callback.
- Four turn inputs: base question bank (life categories from the vision
  doc), pending Asks (prioritized, asker named), session memory, elder
  biographical anchors.
- Voice interface (`Voice` seam) for TTS — ElevenLabs default per DECISIONS;
  mock for tests. The interviewer's synthetic voice is entirely distinct
  from the elder's preserved recordings.
- This is build-against-real-recordings IP — Phase 1 lays the turn loop
  + behavior policy + memory + Voice seam; the question bank + sensitive-
  topic policies live in our code as data files (consider
  `packages/interviewer/src/questions/`).
- **Will likely need a new audited content read** to load past stories for
  cross-session memory (just titles/summaries/tags, NOT the audio bytes).
  Add it to `story-repository.ts` and document in the same commit.

**Increment 5 — VOICE-ONLY APPROVAL GATE**
- Voice approval IN-SESSION; capture `approval_audio` Media (different
  `kind` from `story_audio`, already in the schema enum).
- ATOMIC transition: `pending_approval → approved → shared` at the elder's
  chosen `audienceTier`, AND the first `ConsentRecord`
  (`action=approved_for_sharing`, points at the approval-audio Media) — in
  one transaction. Reuse `transitionStoryState` and `recordConsent`.
- Voice correction regenerates **prose only** (call into
  `renderStoryFromTranscript` again); audio untouched.
- Authorization function MUST already refuse to surface a story without
  `approved`/`shared` state + backing ledger row — it does. But add
  regression tests that exercise the approval flow end-to-end.
- Touches `@chronicle/capture` (approval capture path uses the same
  storage-first ordering pattern as recording capture) + `@chronicle/core`
  (new audited write that does the state transition + consent insert in one
  transaction; add to allowlist).

### Increments 6 + 7 (sequential after I4 + I5)
- **I6 — Basic family hub:** logged-in younger-gen `apps/web` surface;
  approved-stories list (original voice primary, prose secondary); invite-
  link generator (creates `elder_session`); Ask submission. AuthProvider
  seam stubbed (Clerk in prod per DECISIONS).
- **I7 — Asked-question relay:** Ask queued → routed into the interviewer
  queue (one of several prompt sources = seam); prioritize + frame warmly
  with asker named; on approval flip Ask to `answered` + Story pointer +
  notify asker.

### Front-door discipline reminder
Any new content read/write path goes through `@chronicle/core` and is added
to the appropriate ALLOWLIST in `packages/core/test/architecture.test.ts` in
the same commit. The two existing allowlists are exact-membership canaries
— extending them is a deliberate, reviewer-visible event.

### Conventions reminder
- TS strict + `noUncheckedIndexedAccess`; ESM only; `verbatimModuleSyntax`.
- Pure source packages (`main = ./src/index.ts`), `workspace:*` deps.
- Vendor SDKs only in adapter files; the architecture test in
  `packages/pipeline/test/pipeline.test.ts` enforces zero vendor SDK
  imports in `@chronicle/{core,db,storage,capture,pipeline}`. When you add
  `@chronicle/interviewer`, add it to that scan.
- Global preferences (`~/.claude/CLAUDE.md`): regression test after bug
  fix; act adversarial; remember corrections (per-project here).
- Memory at
  `C:\Users\boose\.claude\projects\C--Users-boose-projects-familyapp\memory\`.
  Read `MEMORY.md` early. One feedback memory: always provide a
  continuation prompt when suggesting clean context.

### Optional: parallelize I4 + I5 via Agent Teams
See `docs/NEXT-SESSION.md` § Parallelization for the recommended split,
shared-contract-first lock, and team prompts. Default to sequential if the
shared contracts aren't crisp.

Begin with reading the spec + PLAN/PROGRESS/DECISIONS/OPEN-QUESTIONS, then
state the I4 (or I4+I5) plan in 3-5 lines and start building.

---

## Parallelization analysis — which increments can run via Agent Teams

The workflow we have been using (sequential build → cold reviewer → enhance)
is *review* parallelism, not *build* parallelism. Build parallelism via
Agent Teams is only safe when shared contracts are locked first — otherwise
you get the classic "frontend assumed X, backend produced Y" mismatch the
global preference warns about.

### Dependency graph of the remaining increments

```
I3 (done) ──┬──> I4 INTERVIEWER ──────────┐
            │                              ├──> I7 RELAY (final)
            └──> I5 APPROVAL GATE ──> I6 HUB ─┘
```

- **I4** consumes the `LanguageModel` + `Voice` seams; produces a turn
  loop with cross-session memory + question bank + Ask consumer. Mostly
  new code in `@chronicle/interviewer`.
- **I5** consumes the story state machine + consent ledger; produces an
  atomic approval write path + `approval_audio` capture. Touches
  `@chronicle/{core, capture}` and adds an audited write.
- **I6** consumes approved stories from I5 (otherwise the hub has nothing
  to show) and the invite-link primitive from `@chronicle/capture`.
  Sequential after I5.
- **I7** consumes the interviewer's Ask-consumption seam from I4 and the
  Ask submission UI from I6. Sequential last.

### Recommended split

**I4 + I5 are the only safe parallel pair.** They touch different files
and depend on disjoint surfaces of what already exists. Use Agent Teams
with a blocking shared-contracts step first.

| Step | Mode | What |
|------|------|------|
| 0 | **Solo, blocking** | You (lead) lock the shared contracts: (a) the audited write signature for the I5 atomic-approval transaction (function name, args, return); (b) the `Voice` interface that both I4 (TTS the question) and I5 (record the elder's approval audio — actually, approval audio is captured via the same `CapturedAudio`/`ingestRecording` shape from I2, no new Voice work needed there); (c) the interviewer's Ask-consumption shape if I7's UI side will land in I6. Write these as TypeScript interfaces and commit. |
| 1 | **Team, parallel** | Two agents in parallel: one builds `@chronicle/interviewer` (I4); the other builds the approval gate in `@chronicle/{core, capture}` (I5). Each writes real asserting tests. Neither agent touches the other's files. |
| 2 | **Solo** | You run both fresh adversarial reviewers (one per increment) in parallel. Enhance each. Re-eval. Commit each increment separately. |
| 3 | **Solo, sequential** | I6 (depends on I5 output). |
| 4 | **Solo, sequential** | I7 (depends on I4 + I6). |

### What NOT to parallelize

- **I5 + I6.** I6 reads "approved stories" — the very thing I5 produces.
  Parallel = the I6 agent will mock approval-state stories that drift from
  what I5 actually writes. Sequential.
- **I4 + I7.** I7 plugs Asks into the interviewer's prompt queue. That
  queue is exactly the in-house turn-loop surface I4 builds. Parallel =
  contract drift on the queue shape. Sequential.
- **Anything that touches the architecture-guard allowlists** done in
  parallel by two agents. Both will edit `architecture.test.ts` and
  conflict, or worse, one will silently widen the allowlist without the
  other knowing. The shared-contracts-first step must include any new
  allowlist entries, locked by the lead.

### Team prompts (paste into TeamCreate)

For the parallel I4 + I5 run, after the contracts step:

**Agent A — Interviewer (I4):**
> Build Increment 4 (interviewer behavior) per `docs/PLAN.md`. New package
> `@chronicle/interviewer` only. Consume the `LanguageModel` interface from
> `@chronicle/pipeline` and the new `Voice` interface locked in the shared-
> contracts commit (HEAD). Implement the turn loop, behavior policy,
> question bank, cross-session memory, Voice mock. Real asserting tests.
> Do NOT modify any file outside `packages/interviewer/`. Do NOT modify
> `packages/core/test/architecture.test.ts`. If you need a new audited
> read of past stories, stop and ask the lead.

**Agent B — Approval gate (I5):**
> Build Increment 5 (voice-only approval gate) per `docs/PLAN.md`. Touch
> only `packages/core/src/`, `packages/capture/src/`, and their tests.
> Implement: capture `approval_audio` via the same storage-first ordering
> as `ingestRecording`; one new audited write in
> `packages/core/src/story-repository.ts` that atomically transitions
> `pending_approval → approved → shared` and inserts the first
> `ConsentRecord`. Use `transitionStoryState` and `recordConsent`. Voice
> correction regenerates prose only via `renderStoryFromTranscript`. Add
> regression tests that the authorization function refuses to surface a
> story without state ≥ approved + backing ledger row. Do NOT modify any
> file outside `packages/{core,capture}/` and do NOT change the
> architecture allowlist (the lead already locked the new entry in the
> shared-contracts commit).

### Should you actually parallelize?

**Probably not for I4.** The interviewer is the IP and the spec is
deliberately vague — it deserves the most iteration and your direct
attention. Parallelizing I4 with I5 will get I5 done while you focus
elsewhere, but I4's behavior policy is exactly the thing that benefits
from synchronous decision-making with the reviewer. The honest
recommendation: **sequential I4 (with full attention) → parallel-or-sequential
I5 → I6 → I7**. Parallelize only if you genuinely need the wall-clock win.

If you do parallelize, the shared-contracts-first commit is non-negotiable.
