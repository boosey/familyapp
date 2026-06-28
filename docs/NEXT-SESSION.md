# Continuation Prompt — Next Session

Paste the prompt block below into a fresh Claude Code session. It is self-contained.

> **Maintenance note:** keep the "State of the build" section honest. This file was
> badly stale once (it claimed Increment 5 was next long after the whole build had
> shipped) and nearly sent a fresh session re-building finished work. If you finish
> something, update the HEAD hash + the done/next lines here in the same pass.

---

## Prompt to paste

You are the lead engineer continuing the Phase 0 + Phase 1 build of "Family
Chronicle", an AI-first family-storytelling product. The core build is COMPLETE
and committed — you are now in the polish / verification / next-phase stage, NOT
the increment build-out. Do not rebuild finished work.

### Read these first (in order)
1. `CLAUDE.md` (repo root) — short orientation written for fresh sessions
2. `docs/Phase-0-1-Engineering-Spec.md` — source of truth (read in full)
3. `docs/PLAN.md` — increment checklist (all increments ✅ done)
4. `docs/PROGRESS.md` — eval log per increment + the hi-fi design pass + vendor adapters
5. `docs/DECISIONS.md` — every non-obvious choice already made + why
6. `docs/OPEN-QUESTIONS.md` — stubs + acknowledged Phase-1 gaps (not violations)
7. `docs/superpowers/specs/2026-06-27-hi-fi-design-pass-design.md` +
   `docs/superpowers/plans/2026-06-27-hi-fi-design-pass.md` — the UI pass (done)

### Operating mandate (unchanged)
Own the implementation; make engineering decisions yourself without asking,
except (1) a spec ambiguity with materially different hard-to-reverse
architectures, or (2) anything requiring real-world action (paid accounts,
vendor signup, real personal data, cost) — stub those and note in
OPEN-QUESTIONS. Honor the LOCKED decisions + 3 principles as inviolable
(the narrator never feels they use software; authenticity beats polish / original
audio canonical and never overwritten; consent owned by the person, enforced
at the data layer).

### Environment
- Repo IS on local disk (`C:\Users\boose\projects\familyapp`) — not Google Drive.
- pnpm install is clean; PGlite + Vitest stable.
- DO NOT run `next build` or `next dev` until the user explicitly asks. For
  web verification use `pnpm -F @chronicle/web exec tsc --noEmit`.
- `cd` does NOT persist between Bash tool calls — use `pnpm -F <pkg> exec ...`
  from the repo root, or pass absolute paths.

### State of the build (HEAD = `ccbc299` — "new audio controls")
Everything in the spec's build sequence is DONE and eval-clean:
- Increments 0–7: ✅ all done (spine, capture, pipeline, interviewer, approval
  gate, family hub, asked-question relay). See PROGRESS.md per-increment log.
- Six vendor adapters (Groq / ElevenLabs / R2 / Clerk / Inngest / Supabase
  Postgres): ✅ wired behind seams, eval-clean. API keys still required to
  invoke against real services; CI does not run them.
- Hi-fi design pass over `apps/web`: ✅ done. App migrated off the stale
  `--kin-*` tokens to the semantic token layer (`--accent`/`--surface-*`/
  `--text-*`, rem scale, DM Mono, 3 themes); all six Kindred components
  reconciled to the showcase; narrator conversation + approval screens rebuilt;
  family hub rebuilt as one tabbed shell (Stories / Questions / Ask / Asks /
  Invite) with account menu + tab badges; old `/hub/*` routes redirect in.
- Onboarding + family flows (landing, auth, invite, join, steward approvals):
  ✅ landed (commits `2d128de`→`da59f1e`).
- **New audio control (`KindredListenBar`): ✅ done (`ccbc299`).** It is the
  sophisticated functional scrubber — seekable track + thumb, current/total
  timecode, transport row (⏮ restart · ↺10 back · ▶/❚❚ play · ↻10 fwd · ⏭ next),
  real `<audio>` playback in audio (`src`) mode, controlled `playing`/`onToggle`
  mode otherwise. It matches `…/project/Kindred Listen Bar.dc.html` (the live
  design prototype). NOTE: the embedded copy of `KindredListenBar` inside
  `…/_ds/…/_ds_bundle.js` is STALE — it still shows the old single-button pill
  with a static waveform. The bundle is a generated reference artifact we
  consume, not edit; ignore that copy. The `.dc.html` prototype is authoritative.

### What's actually open
- **Manual visual fidelity walk** (the one carried-over TODO): with a browser,
  run `pnpm -F @chronicle/web dev`, seed via `/dev/seed`, and walk each screen
  against `…/project/Family Chronicle.dc.html` — narrator conversation, narrator
  approval, hub (each tab + account menu + badges), story detail, and the
  listen-bar scrubber. Repeat with `data-theme="archive"` and `"hearth"`. Note
  + fix any fidelity gaps. (Only do this when the user asks to start the dev
  server.)
- Anything in `docs/OPEN-QUESTIONS.md` still marked open.
- Next-phase work is the user's call — ask before starting a new initiative.

### Two architecture allowlists are in force (both exact-membership)
- Content tables (`@chronicle/db/content`): exactly `authorization.ts` +
  `story-repository.ts`.
- Pipeline system-actor read (`@chronicle/core/pipeline`): exactly
  `packages/pipeline/src/orchestrator.ts`.
Any new audited content read/write path goes through `@chronicle/core` and is
added to the appropriate ALLOWLIST in `packages/core/test/architecture.test.ts`
in the SAME commit. Both are exact-membership canaries — quiet widening is not
possible. Raw SQL via `db.execute(sql\`…\`)` is the documented, out-of-scope
bypass (code review catches it).

### Conventions reminder
- TS strict + `noUncheckedIndexedAccess`; ESM only; `verbatimModuleSyntax`.
- Pure source packages (`main = ./src/index.ts`), `workspace:*` deps.
- Vendor SDKs only in adapter files; the architecture test in
  `packages/pipeline/test/pipeline.test.ts` enforces zero vendor SDK imports in
  `@chronicle/{core,db,storage,capture,pipeline,interviewer}` (R2 is the one
  documented exception for `packages/storage/src/r2.ts`).
- Workflow: subagent-driven — a coding sub-agent writes; a FRESH adversarial
  reviewer sub-agent reviews; iterate until clean (DECISIONS § Workflow).
- Global prefs (`~/.claude/CLAUDE.md`): regression test after bug fix; act
  adversarial; remember corrections (per-project here).
- Memory at
  `C:\Users\boose\.claude\projects\C--Users-boose-projects-familyapp\memory\`.
  Read `MEMORY.md` early.

Commit messages end with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

Begin by reading the spec + PLAN/PROGRESS/DECISIONS/OPEN-QUESTIONS, then ask the
user what they want to tackle (visual fidelity walk, an open question, or
next-phase work) rather than assuming there is more of the build sequence to do.
