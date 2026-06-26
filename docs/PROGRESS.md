# PROGRESS

Tracks which build-sequence increment is active and the eval status of each completed one.

| Increment | Status | Eval rounds | Final verdict |
|-----------|--------|-------------|---------------|
| 0 — Repo & toolchain scaffold | ✅ done | n/a | — |
| 1 — The spine | ✅ done | 3 | NO SPEC VIOLATIONS |
| 2 — Capture path | ✅ done | 2 | NO SPEC VIOLATIONS |
| 3 — Pipeline | ⬜ | — | — |
| 4 — Interviewer | ⬜ | — | — |
| 5 — Approval gate | ⬜ | — | — |
| 6 — Family hub | ⬜ | — | — |
| 7 — Asked-question relay | ⬜ | — | — |

## Log

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
