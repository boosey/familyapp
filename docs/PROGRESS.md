# PROGRESS

Tracks which build-sequence increment is active and the eval status of each completed one.

| Increment | Status | Eval rounds | Final verdict |
|-----------|--------|-------------|---------------|
| 0 — Repo & toolchain scaffold | ✅ done | n/a | — |
| 1 — The spine | ✅ done | 3 | NO SPEC VIOLATIONS |
| 2 — Capture path | ✅ done | 2 | NO SPEC VIOLATIONS |
| 3 — Pipeline | ✅ done | 3 | NO SPEC VIOLATIONS |
| 4 — Interviewer | ✅ done | 3 | NO SPEC VIOLATIONS |
| 5 — Approval gate | ⬜ | — | — |
| 6 — Family hub | ⬜ | — | — |
| 7 — Asked-question relay | ⬜ | — | — |

## Log

- **2026-06-26** — Increment 4 (interviewer) eval-clean (3 rounds). New `@chronicle/interviewer`
  package: `Voice`/`AskSource`/`MemorySource`/`AnchorSource` seams (`ScriptedVoice` +
  in-memory mocks); base question bank as data (`questions/bank.ts`) keyed by
  category/sensitivity/lifePhase with absolute drafting rules in the file header; pure
  `behavior.ts` picker enforcing priority order (distress → off-ramp → callback-on-turn-0 →
  pending Asks → follow_up → base) with rapport-gated high-sensitivity, reminiscence-bump
  weighting, and named policy constants; `phraser.ts` wrapping the LLM (NOT an open chat) with
  in-house system prompt + per-Intent user blocks; `turn-loop.ts` composing the session;
  `core-adapters.ts` bridging seams to audited core reads. New AUDITED content read
  `listElderMemoryForInterviewer` on `story-repository.ts` (already in the allowlist) projects
  ONLY safe metadata at the SQL layer — transcript/prose/storageKey never selected. Round 1:
  NO SPEC VIOLATIONS, 3 advisories. Triage: pushed the metadata-only contract DOWN into the
  audited boundary (added `listElderMemoryForInterviewer` so the projection is in SQL not in
  the consumer). Round 2: NO SPEC VIOLATIONS, 3 advisories. Closed two: stale docstring in
  `core-adapters.ts`; sticky `follow_up` (cleared `lastElderUtterance` on `follow_up`
  consumption — with regression test asserting fallback to base on the next pick). Round 3:
  NO SPEC VIOLATIONS, no advisories. 110 tests green (db 11, storage 11, core 34, capture 11,
  pipeline 20, interviewer 24); all packages + apps/web typecheck. Architecture-test allowlist
  canary unchanged (still exactly `authorization.ts` + `story-repository.ts`). Vendor-SDK
  guard now scans `packages/interviewer/src` too; zero SDK leaks.
- **2026-06-26** — Increment 3 (pipeline) eval-clean (3 rounds). Built new `@chronicle/pipeline`
  package: contracts (`Transcriber`, `LanguageModel`, `JobQueue`, `WorkingCopyTransformer`),
  `InProcessJobQueue` (dedupe + per-drain attempt cap), default working-copy transformer (honest
  stub: reports `speedFactor: 1.0` because it does no DSP — see OPEN-QUESTIONS), 1x-time mapping
  helper, `ScriptedTranscriber/LanguageModel` mocks, in-house speech-to-story prompt + defensive
  parser (`render-story.ts`), orchestrator wiring transcribe → render_story stages. Wired
  `assertStoryTransition` at the render write site (Increment 1 deferral closed). Added narrow
  audited writes to `story-repository.ts`: `updateDerivedFields`, `transitionStoryState`,
  `getStoryAndRecordingForPipeline`. Round 1: NO HARD VIOLATIONS, 13 advisories. Triage: stub
  transformer's "speedFactor=1.6 reported but no DSP applied" was a real sleeper bug (timings
  off by 1.6x in prod) — fixed by reporting `1.0` honestly. Added retry cap on in-proc queue,
  expanded forbidden-SDK list, wired elder context (`spokenName`/`birthYear`) through to render,
  hardened canonical-bytes test with mutation, parseRenderResponse rejects arrays/null, added
  audienceTier-never-written + media-row-count regressions, doc'd DSP/stitching gaps in
  OPEN-QUESTIONS. Round 2: NO SPEC VIOLATIONS, 12 advisories. The architectural advisory —
  `getStoryAndRecordingForPipeline` re-exported from `@chronicle/core` root, defended by
  convention not structure — was closed: helper moved behind `@chronicle/core/pipeline` subpath
  with a NEW architecture guard (PIPELINE_HELPER_ALLOWLIST, exact-membership = 1 file:
  `pipeline/src/orchestrator.ts`). Empty-transcript ping-pong (would burn 8 paid vendor calls
  on a failure) closed: transcribe stage throws on empty result with regression test asserting
  exactly one vendor call + story untouched. Round 3: NO SPEC VIOLATIONS, 5 minor advisories.
  Knocked off one more — orchestrator now refuses any `speedFactor > 2.0` from a transformer
  (defense in depth against a buggy real DSP adapter shipping later). 84 tests green
  (db 11, core 31, capture 11, storage 11, pipeline 20); all packages + apps/web typecheck.
- **2026-06-26** — Read spec + kickoff in full. Scaffolded repo (git init, pnpm workspace
  layout), copied spec to `docs/`, wrote PLAN/DECISIONS/OPEN-QUESTIONS/PROGRESS. Resolved all
  stack "OR" choices (see DECISIONS). Starting Increment 0 toolchain, then Increment 1 (spine).
- **2026-06-26** — Increment 2 (capture path) eval-clean. Review r1 surfaced 1 hard violation
  (orphan-blob ordering) and 11 advisories. Triage: the storage-first ordering is the *correct*
  spec-aligned trade-off (authenticity beats polish / audio preserved as recoverable evidence) —
  defended in DECISIONS rather than reversed. Enhanced: (1) `getElderProfile` core helper (elder
  page no longer reads `persons` directly); (2) `lastUsedAt` write wrapped in try/catch so a
  transient write does not 500 the elder page (+ regression test using a Proxy DB); (3) capture
  test for invalid session now asserts zero storage objects AND zero media/story rows (was
  hollow); (4) added two partial-failure tests — DB-after-storage-fails preserves audio +
  rolls back DB; storage-fails leaves no DB rows; (5) architecture allowlist canary tightened
  from `<=8` to exact membership; (6) fixed misleading `/schema` mention in the architecture
  guard's failure message; (7) added `size` getter on `InMemoryMediaStorage` (drops a brittle
  private-field cast in tests); (8) R2 stub now has a test asserting it throws on every
  credentialed call (catches a future silent-no-op implementer). Review r2: NO HARD VIOLATIONS,
  9 minor advisories addressed inline. 62 tests green (db 11, core 29, capture 11, storage 11).
- **2026-06-26** — Increment 2 (capture path) built; awaiting adversarial review. Added
  `@chronicle/storage` (MediaStorage iface + in-memory/filesystem + write-once R2 stub),
  `@chronicle/capture` (hashed session tokens = zero-login identity, source-agnostic
  `ingestRecording` that persists immutable audio BEFORE any processing then calls the single
  core write path `persistRecordingAndCreateDraft`), `apps/web` (thin elder surface `/s/[token]`
  + `/api/capture` route + dev wiring). Front-door guard updated: `story-repository.ts` added to
  the audited allowlist as the single write path; `@chronicle/db/content` is the guarded subpath
  for content tables. 56 tests pass (db 11, core 29, storage 8, capture 8); all four packages +
  apps/web typecheck clean. Web mic + dev-server E2E unverified in headless env (documented in
  PLAN). Repo moved off Google Drive to local disk; pnpm install clean after move.
- **2026-06-26** — Increment 1 (the spine) complete and eval-clean. Built: full Drizzle schema
  (8 entities + elder_sessions), DB-trigger-enforced append-only ledger + media immutability,
  the single authorization function (4-tier), consent ledger API, story state machine. 33 tests
  (11 db + 22 core) + 4 architecture-guard tests, all green; both packages typecheck clean.
  Eval round 1: 0 hard violations, 4 advisories (front door convention-only, 2 test gaps, unwired
  state guard). Enhanced. Eval round 2: found 2 REAL bypasses (schema re-export + db.query
  relational API) — the single most important Phase-0 principle was not actually closed. Fixed
  structurally (schema not registered on client; subpath/export removed; guard broadened; runtime
  test). Eval round 3: NO SPEC VIOLATIONS. Now starting Increment 2 (capture path).
