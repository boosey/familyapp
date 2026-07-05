# PROGRESS

Tracks which build-sequence increment is active and the eval status of each completed one.

| Increment | Status | Eval rounds | Final verdict |
|-----------|--------|-------------|---------------|
| 0 — Repo & toolchain scaffold | ✅ done | n/a | — |
| 1 — The spine | ✅ done | 3 | NO SPEC VIOLATIONS |
| 2 — Capture path | ✅ done | 2 | NO SPEC VIOLATIONS |
| 3 — Pipeline | ✅ done | 3 | NO SPEC VIOLATIONS |
| 4 — Interviewer | ✅ done | 3 | NO SPEC VIOLATIONS |
| 5 — Approval gate | ✅ done | 2 | NO SPEC VIOLATIONS |
| 6 — Family hub | ✅ done | 3 | NO SPEC VIOLATIONS |
| 7 — Asked-question relay | ✅ done | 1 | NO SPEC VIOLATIONS |
| Vendor adapters (Phase 1 finish) | ✅ done | 6 adapters × 2 rounds | NO SPEC VIOLATIONS, 6 rounds × 6 adapters = 12 adversarial reviews / 6 fixers |
| Hi-fi design pass (web UI) | ✅ done | per-task adversarial review | All gates green; manual visual walk pending |

## Log

- **2026-07-05** — **Story-share multi-family picker COMPLETE** on the `feat/multi-family-picker`
  branch. Retires the "story-compose has NO family-target picker" deferral from the family-scope-
  selector increment below: the web share/review step (self-authored tellings AND answers to asks)
  now renders a multi-family picker for `family`/`branch` tiers via the shared `<FamilyPicker>`
  component (unifying the ask, album, and story-share pickers). The selection is seeded from the
  answered ask's families (answers) or the hub `?scope=` (tellings) and resolved server-side by
  `resolveComposeFamilies` in `shareAnswerAction`; a single-family author sees no picker (auto-
  resolved), an ambiguous multi-family case forces an explicit pick. Core: `approveAndShareStory`
  now takes an explicit `familyIds` param that, when non-empty, **replaces** the
  `computeDefaultFamilyTargets` default, is re-validated against the owner's ACTIVE memberships, and
  is written as `story_families` in the same transaction — the new shared `replaceStoryFamilyTargetsTx`
  helper now backs both this and `setStoryFamilyTargets`. The album/photo-upload picker also seeds its
  default from `?scope=`. Ask multi-family targeting (`ask_families`) is unchanged. No leakage-
  suppression display gate was built — no answer-story renders its originating question in any feed, so
  that concern was investigated and found MOOT.
- **2026-07-05** — **Family scope selector COMPLETE** on the `feat/family-scope-selector` branch
  (Increments 1–4 + the Invite-gate fix). Creating a family and requesting to join a family are now
  always-available in-app actions rather than one-time onboarding stops, and the hub is multi-family
  aware. **Inc 1** — hub scope selector `[ All ▾ ]` (`apps/web/app/hub/HubScopeSelector.tsx`): rows
  for `All` + each active family, muted pending-join rows, pinned `+ Create a family` / `Find a family
  to join` actions; owns a single server-read `?scope=` param (default `all`, validated in
  `hub/page.tsx` against the viewer's active families with a leak-safe fallback to `all`); dead
  `manage-family` account-menu stub removed; the pre-existing per-tab controls (Stories' client-side
  `?scope=`, Album's `?family=`) retired into this one param. **Routing** — `resolvePostAuthRoute`
  Gate C DELETED: an onboarded pending-only user now lands in `/hub` (empty-state hub) instead of
  `/families/find`; zero-relationship still → `/families/start`, not-onboarded still → `/welcome`.
  **Inc 2–3** — read tabs (Stories, Album, Asks) show a deduped union in `All` and filter to one
  family when scoped (an item tagged to N families appears once in `All`, once per family scope);
  Ask compose gets a family multi-select seeded from scope (requires ≥1 family, server-guarded);
  Requests filters by scope and aggregates per-family in `All`. **Inc 4 data model** — asks joined
  the N-family content model: new `ask_families` M2M join table replaced the single nullable
  `asks.familyId`; `createAsk` takes `familyIds: string[]`, story approval unions the ask's families
  into `story_families`, `eraseAsk` gathers stewards across all of them. **Invite-gate fix** — Invite
  is single-family: forces an explicit pick in `All` with >1 family (`resolveInviteFamilyId`), hidden/
  empty-stated for members-of-none. **Deferral (not a bug):** story-compose has NO family-target
  picker — story `story_families` targets stay auto-derived at approval
  (`computeDefaultFamilyTargets`); `setStoryFamilyTargets` exists in core but is unwired; the ADR-0010
  story multi-target picker remains future work. Migration `0003_equal_master_mold.sql` (create
  `ask_families` → backfill from legacy `family_id` → drop the column) applies to Neon at deploy like
  `0001`/`0002`; snapshot regenerated so the drift-guard stays green. Design +
  plan: `docs/superpowers/specs/2026-07-05-family-scope-selector-design.md`,
  `docs/superpowers/plans/2026-07-05-family-scope-selector.md`.
- **2026-07-04** — **ADR-0014 (the composing surface) Increment 0–5 COMPLETE** on the
  `composing-surface` branch (NOT pushed / merged to master). The monolithic `transcribe → render`
  on-stop + `pending_approval` review editor (behind the "Polishing your words" spinner) is retired
  in favor of a live `DRAFT` composing surface: **authored prose** (a composite of spoken + typed +
  corrected + polished input, sealed at approval — no longer regenerated from audio; amends ADR-0007
  §7), **per-take capture** (each voice/typed take appended non-clobbering onto the client's editor
  text), the **four passes** (Transcription `ai_transcribed` → per-take Cleanup `ai_cleaned` → opt-in
  Polish `ai_polished` → `human_corrected`; typed = `user_authored`, skips transcribe+cleanup), an
  explicit **Finish** (`deriveMetadata` + `human_corrected` snapshot + DRAFT → PENDING_APPROVAL) with
  a speculative **Finish-check**, and a still-separate **Share** consent tap (ADR-0004; one immutable
  `approved_for_sharing` ledger row). Per-take Transcription + Cleanup run **synchronously inline in
  the capture action** (no durable Inngest hop per take; the durable queue + legacy orchestrator
  survive only for the link-session `/s/[token]` surface). **Intake** (`/hub/about-you`) shares the
  surface but stops at anchor extraction (not a Story; separate `intake_revisions` ledger, Inc-4);
  memory extraction is consent-gated (Story post-approval, intake at Save). **Observability** (Inc 5):
  server `plog`/`plogError` correlated per request by a cid via `beginLogContext` (AsyncLocalStorage;
  intake path correlated too) + a client `clog` per capture-state transition — toggles
  `CHRONICLE_PIPELINE_LOG` / `CHRONICLE_PIPELINE_LOG_FULL` (server) and
  `NEXT_PUBLIC_CHRONICLE_CLIENT_LOG` / `localStorage["chronicle:clog"]` (client). Built
  subagent-driven, each slice closed by a fresh cold adversarial reviewer; `pnpm -r typecheck` /
  `pnpm -r test` / web build all green. Docs trued up to the shipped flow (this doc-truing unit):
  `docs/adr/0014-*` status → Implemented + two implementation notes; `docs/adr/0007-*` §7 amendment;
  `docs/Recording-To-Story-Pipeline.md` full rewrite; `docs/PLAN.md` ADR-0014 section.
- **2026-06-27** — Hi-fi design pass over `apps/web` (UI/presentation only; data/auth/core
  untouched). Migrated the app off the stale flat `--kin-*` tokens to the design system's
  **semantic token layer** (`--accent`/`--surface-*`/`--text-*`, rem type scale, DM Mono, 3
  themes) via a temporary `--kin-*` shim that was removed once all consumers converted. All six
  Kindred components reconciled to the updated showcase APIs (`KindredVoiceButton` listening/size,
  `KindredListenBar` controlled+audio, `KindredStoryCard` year/place/excerpt, etc.). Narrator
  conversation + approval screens rebuilt to the showcase. **Family hub restructured into a single
  tabbed shell** (Stories / Questions / Ask / Asks / Invite) with an account avatar menu + tab
  badges; the old `/hub/ask|asks|invite|invite/result` routes now redirect into the tabs, with
  all server actions and the once-shown invite token preserved. Built subagent-driven: each task
  implemented by a coding sub-agent → fresh adversarial reviewer sub-agent → coding agent
  iterated until clean (per the corrected workflow in DECISIONS § Workflow). Gates: `pnpm -r
  typecheck` clean; web 12/12, core 60/60 (front-door/consent guards), pipeline 21/21; web build
  green (16 routes). Manual visual fidelity walk against `Family Chronicle.dc.html` still
  outstanding (browser unavailable in this session). Onboarding flow explicitly out of scope.
- **2026-06-27** — Six vendor adapters landed (Groq / ElevenLabs / R2 / Clerk / Inngest /
  Supabase Postgres). Each one: built by sub-agent → adversarial fresh-eyes sub-agent review
  → fixer sub-agent applied findings. All eval-clean. The front-door invariant got
  *strengthened* during this wave — Supabase's `Database` type was narrowed to
  `Record<string, never>` so `db.query.stories` is a COMPILE-TIME error (not just runtime
  `undefined`), pinned by a `@ts-expect-error` regression in
  `packages/core/test/architecture.test.ts`. R2 required ONE documented exception in the
  vendor-SDK guard (`packages/pipeline/test/pipeline.test.ts`) for
  `packages/storage/src/r2.ts`; all other vendor SDKs remain in their adapter packages
  outside the IP tree. Test counts per new/changed package: `transcribe-groq` 13,
  `voice-elevenlabs` 10, `storage` +9 R2 = 17 total, `queue-inngest` 15, `apps/web` +12
  Clerk = 12, `db` +2 Postgres-narrowing/migration = 13 total. Verified clean: 212 tests
  passing across 11 packages; `pnpm -r typecheck` clean (after fixing a missing
  workspace-paths block in `packages/transcribe-groq/tsconfig.json`). Architecture-test
  allowlists unchanged. Per-adapter design decisions captured in
  `docs/DECISIONS.md` (new "Vendor adapters (Phase 1 finish)" section). API keys are still
  required to actually invoke any of these against real services — adapters are wired but
  the build does not run them in CI.
- **2026-06-26** — Increment 7 (asked-question relay) eval-clean (1 round).
  Closes the self-feeding loop. New `@chronicle/core` lifecycle helpers `markAskRouted`
  (queued→routed; idempotent; rejects answered→routed) and `markAskAnswered` (rejects
  same-ask-different-story); `listAsksByAsker` for the asker's hub notification.
  `approveAndShareStory` extended: in the SAME `db.transaction` as the consent insert, if
  `story.askId` is non-null, flip the Ask to `answered` with the story pointer + answeredAt.
  Rejects if the linked Ask is already answered by a DIFFERENT story (one Ask → one Story).
  Interviewer: `AskSource` contract extended with `markRouted`; `InMemoryAskSource.markRouted`
  records calls (no-op semantically); turn loop calls `askSource.markRouted` after a
  successful `ask` intent (failure swallowed — never erases the synthesized turn). New
  `createCoreAskSource(db)` adapter uses ONLY core exports (`listPendingAsksForNarrator` +
  `markAskRouted`) — no direct asks-table access, mirroring the memory adapter's discipline.
  Web: `/api/capture` accepts optional `askId` form field forwarded to `ingestRecording`
  (so the narrator-side answer to an Ask carries the back-pointer). New `/hub/asks` server
  component lists the asker's submitted asks; answered ones link to the Story via
  `getStoryForViewer` (authorized) — shows "Answered (not shared with you)" when the
  authorization function denies, so no story content leaks. Anchor `id="story-{id}"` added
  on each hub story `<li>` so the deep link resolves.
  Round 1: NO SPEC VIOLATIONS. 145 tests green (db 11, storage 11, core 59, capture 17,
  pipeline 21, interviewer 26); all packages + apps/web typecheck clean. Architecture-test
  allowlist canary unchanged. Vendor-SDK guard: zero leaks.
- **2026-06-26** — Increment 6 (basic family hub) eval-clean (3 rounds).
  New `@chronicle/core` Ask repository (`asks.ts`): `createAsk` enforces shared-active-family
  co-membership at the boundary (rejects anonymous, ended/paused, strangers, empty questions,
  and form-spoofed familyIds); `listPendingAsksForNarrator` is the I7 seam returning
  queued/routed asks in arrival order with the asker's spoken name. Asks live on the open
  schema surface — no architecture allowlist change.
  New `apps/web/lib/auth.ts` AuthProvider seam (interface + DevCookie stub; Clerk is the
  named prod adapter, stubbed per OPEN-QUESTIONS). Wired through `lib/runtime.ts`. All hub
  pages authenticate via `auth.getCurrentAuthContext()` — no direct cookie reads in pages.
  New hub pages: `/hub` (`hub-data.ts` `loadHubFeed` lists each co-member's stories
  via `listStoriesForViewer`, sorted by approvedAt; audio rendered FIRST, prose in
  `<details>` collapsed); `/hub/invite` (server action → audited `createLinkSession`,
  verifies BOTH inviter and narrator hold active memberships in the chosen family); invite
  result page (raw token handed via short-lived httpOnly flash cookie, deleted on first read
  — NEVER via URL query string); `/hub/ask` (server action → `createAsk`); `/dev/sign-in`
  (writes the dev cookie). New `/api/media/[id]/route.ts` streams bytes only AFTER
  `getMediaForViewer` clears the request — 404 indistinguishable from "no access".
  Round 1: invite did not filter `status='active'` on the inviter's membership query — fixed
  (defense in depth: paused/ended ex-members must not mint links). Round 2: token leaked via
  URL query (logs/history/Referer); chosen narrator not verified to be in chosen family —
  fixed (flash cookie + cross-membership check). Round 3: NO SPEC VIOLATIONS. 133 tests
  green (db 11, storage 11, core 49, capture 17, pipeline 21, interviewer 24); all
  packages + apps/web typecheck clean. Architecture-test allowlist canary unchanged.
- **2026-06-26** — Increment 5 (voice-only approval gate) eval-clean (2 rounds).
  New audited write `approveAndShareStory` in `packages/core/src/story-repository.ts`: ONE
  `db.transaction` inserts the `approval_audio` Media row, walks the Story through
  `pending_approval → approved → shared` with `assertStoryTransition` on both legs (the
  intermediate `approved` row IS persisted in-tx, honoring the spec's three-state wording),
  stamps `audienceTier` + `approvedAt`, and appends the FIRST `ConsentRecord`
  (`action='approved_for_sharing'`, pointing at the new approval-audio Media). Ownership
  re-verified inside the tx (defense in depth on top of the capture-side session check).
  Sibling `applyTranscriptCorrection` clears prose/title/summary/tags + updates transcript,
  gated on `pending_approval` — recording pointer structurally unreachable from this seam.
  New `packages/capture/src/approval.ts` `captureApproval` mirrors `ingestRecording`'s
  storage-first ordering: front-door ownership check via `getStoryForViewer`, upload audio
  bytes to storage BEFORE the DB tx, then call core. Does NOT import `@chronicle/db/content`
  — architecture allowlist unchanged. New `packages/pipeline/src/correction.ts`
  `applyVoiceCorrection` is the tiny coordinator: `applyTranscriptCorrection` →
  `renderStoryFromTranscript` (re-render via in-house prompt) → `updateDerivedFields`. State
  stays `pending_approval`; the narrator's NEXT voice action (approval) is what advances it.
  Round 1: two findings — (1) intermediate `approved` state never persisted (spec wording is
  three states); (2) reviewer flagged atomicity-test mechanism as weak. Fixed (1) by doing
  two sequential UPDATEs inside the tx; (2) is actually solid: `DROP TABLE consent_records
  CASCADE` doesn't cascade to stories/media (no FK back), so the tx starts cleanly and the
  inner consent INSERT genuinely fails mid-tx, and the existing assertions already prove
  rollback of the media row + state. Round 2: NO SPEC VIOLATIONS. 126 tests green (db 11,
  storage 11, core 42, capture 17, pipeline 21, interviewer 24); all packages + apps/web
  typecheck clean. Architecture-test allowlist canary unchanged (still exactly
  `authorization.ts` + `story-repository.ts`). Vendor-SDK guard: zero leaks.
- **2026-06-26** — Increment 4 (interviewer) eval-clean (3 rounds). New `@chronicle/interviewer`
  package: `Voice`/`AskSource`/`MemorySource`/`AnchorSource` seams (`ScriptedVoice` +
  in-memory mocks); base question bank as data (`questions/bank.ts`) keyed by
  category/sensitivity/lifePhase with absolute drafting rules in the file header; pure
  `behavior.ts` picker enforcing priority order (distress → off-ramp → callback-on-turn-0 →
  pending Asks → follow_up → base) with rapport-gated high-sensitivity, reminiscence-bump
  weighting, and named policy constants; `phraser.ts` wrapping the LLM (NOT an open chat) with
  in-house system prompt + per-Intent user blocks; `turn-loop.ts` composing the session;
  `core-adapters.ts` bridging seams to audited core reads. New AUDITED content read
  `listNarratorMemoryForInterviewer` on `story-repository.ts` (already in the allowlist) projects
  ONLY safe metadata at the SQL layer — transcript/prose/storageKey never selected. Round 1:
  NO SPEC VIOLATIONS, 3 advisories. Triage: pushed the metadata-only contract DOWN into the
  audited boundary (added `listNarratorMemoryForInterviewer` so the projection is in SQL not in
  the consumer). Round 2: NO SPEC VIOLATIONS, 3 advisories. Closed two: stale docstring in
  `core-adapters.ts`; sticky `follow_up` (cleared `lastNarratorUtterance` on `follow_up`
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
  expanded forbidden-SDK list, wired narrator context (`spokenName`/`birthYear`) through to render,
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
  defended in DECISIONS rather than reversed. Enhanced: (1) `getNarratorProfile` core helper (narrator
  page no longer reads `persons` directly); (2) `lastUsedAt` write wrapped in try/catch so a
  transient write does not 500 the narrator page (+ regression test using a Proxy DB); (3) capture
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
  core write path `persistRecordingAndCreateDraft`), `apps/web` (thin capture surface `/s/[token]`
  + `/api/capture` route + dev wiring). Front-door guard updated: `story-repository.ts` added to
  the audited allowlist as the single write path; `@chronicle/db/content` is the guarded subpath
  for content tables. 56 tests pass (db 11, core 29, storage 8, capture 8); all four packages +
  apps/web typecheck clean. Web mic + dev-server E2E unverified in headless env (documented in
  PLAN). Repo moved off Google Drive to local disk; pnpm install clean after move.
- **2026-06-26** — Increment 1 (the spine) complete and eval-clean. Built: full Drizzle schema
  (8 entities + link_sessions), DB-trigger-enforced append-only ledger + media immutability,
  the single authorization function (4-tier), consent ledger API, story state machine. 33 tests
  (11 db + 22 core) + 4 architecture-guard tests, all green; both packages typecheck clean.
  Eval round 1: 0 hard violations, 4 advisories (front door convention-only, 2 test gaps, unwired
  state guard). Enhanced. Eval round 2: found 2 REAL bypasses (schema re-export + db.query
  relational API) — the single most important Phase-0 principle was not actually closed. Fixed
  structurally (schema not registered on client; subpath/export removed; guard broadened; runtime
  test). Eval round 3: NO SPEC VIOLATIONS. Now starting Increment 2 (capture path).
