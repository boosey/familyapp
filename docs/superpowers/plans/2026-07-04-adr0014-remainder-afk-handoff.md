# ADR-0014 — AFK handoff: implement the REMAINDER (Inc 3 slices 9–11 → Inc 4 → Inc 5)

You are an **autonomous (AFK) agent**. No human is watching this run. Your job is to carry ADR-0014 to
completion on the existing branch: finish **Increment 3 (slices 9, 10, 11)**, then **Increment 4**, then
**Increment 5**. Work slice-by-slice, TDD, cold-reviewed, committing each slice. **Do not push, do not
merge to master, do not deploy** — leave the finished branch for a human go/no-go. This is the single most
important constraint: nothing you do reaches users until a human merges to master.

## AFK operating rules (differ from the earlier interactive handoffs — read carefully)
- **You cannot ask the user anything.** The prior handoffs say "use `AskUserQuestion` for sign-off on
  behavior changes." That path is unavailable AFK. Instead: for any genuinely-open micro-decision, pick the
  **most conservative option consistent with ADR-0014 and the already-RESOLVED decisions (a)–(d)** in the
  blueprint, **write down the choice + rationale in the commit body AND the blueprint Build-status**, and
  continue. Never block waiting for input. The pre-resolved defaults for the known decision points are in
  "Pre-resolved decisions" below — use them; do not re-litigate.
- **Verify everything yourself.** Named builder/reviewer sub-agents in this repo reliably go idle WITHOUT
  delivering a prose report and sometimes over-claim green. After every builder: `git show --stat`,
  `git log --oneline -3`, run `pnpm -r typecheck` + the affected suites (and the FULL `apps/web` suite)
  yourself before trusting any count. I hit this twice in the session that produced Slice 8.
- **Per-commit bar** = `pnpm -r test` + `pnpm -r typecheck` GREEN. One slice = one code commit (+ optional
  `docs(plan): record …` commit). Never leave the tree red between slices.
- **After each bug fix, a companion regression test** (repo rule).
- **Stop conditions (halt the run and write a status note, don't thrash):** a slice can't go green after two
  builder+review rounds; a change would require amending the frozen shared contract; a schema change is
  needed (would require reseeding both Neon branches — out of an AFK agent's safe scope); or the architecture
  guard (`packages/core/test/architecture.test.ts`) fails and the only fix is a new content-path allowlist
  entry you're not sure is legitimate. In any of these, commit what's green, write the blocker into the
  blueprint Build-status + memory, and stop.

## Authoritative docs — READ FIRST, do not duplicate them (they supersede this handoff on conflict)
- **Rollout roadmap** `docs/superpowers/plans/2026-07-03-composing-surface-adr0014-rollout.md` — the Inc 0–5
  decomposition. **§Increment 4** and **§Increment 5** are your spec for those increments (this handoff does
  not restate them).
- **Inc 3 blueprint** `docs/superpowers/plans/2026-07-03-adr0014-inc3-blueprint.md` — the 11-slice sequence,
  the **Build status** section (current **through Slice 8**), **RESOLVED DECISIONS (a)–(d)**, **Risks/gotchas**,
  and the **Slice-10 forward risks**. This is your slice-by-slice spec for 9/10/11.
- **Frozen shared contract** `docs/superpowers/plans/2026-07-03-adr0014-shared-contract.md` (§4 core
  signatures, §6 orchestration). **Do NOT change the contract in a slice; stop if a slice seems to need it.**
- **Prior handoffs** (Slice 9/10/11 detail lives here — reference, don't restate):
  `2026-07-04-adr0014-inc3-slice6plus-handoff.md` (§"Slices remaining" 9–11 + the Slice-10 forward risks) and
  `2026-07-04-adr0014-inc3-slice8plus-handoff.md`.
- **Root `CLAUDE.md`** — single-front-door rule, vendor-seam rule, subagent-driven workflow.
- **Persistent memory** `project_adr0014_rollout_status.md` — up to date **through Slice 8**. Update it as
  each slice/increment lands.

## Environment / worktree (cwd resets — ALWAYS absolute-cd)
- Worktree: `C:/Users/boose/projects/familyapp/.claude/worktrees/composing-surface-inc1-3`
  (branch `worktree-composing-surface-inc1-3`). **HEAD = `04c11ce`** (docs record) on top of **`e21e97b`**
  (Slice 8 code).
- Prefix EVERY shell command: `cd "C:/Users/boose/projects/familyapp/.claude/worktrees/composing-surface-inc1-3" && …`
- Windows; Bash tool available. `pnpm -r typecheck`; full web suite `pnpm --filter @chronicle/web test`;
  single file `pnpm --filter @chronicle/web exec vitest run <path>`; core `pnpm --filter @chronicle/core …`.
  DB/core tests run in-process PGlite (no external Postgres).
- **Commit-author gate (Vercel blocks otherwise):** author every commit as
  `Alex Boudreaux <boosey.boudreaux@gmail.com>` — use `--author="Alex Boudreaux <boosey.boudreaux@gmail.com>"`.

## Current baselines (post-Slice-8, verified independently 2026-07-04)
core **277**, pipeline **74**, capture **38**, apps/web **393**, `pnpm -r typecheck` exit 0.
Core barrel exports `appendVoiceTakeContribution`, `appendTypedTakeContribution`, **and `finishDraft`**.
Pipeline barrel exports `polishProse`, `cleanupTake`, `deriveMetadata`.

## Method (repo-mandated)
Subagent-driven TDD, ONE writer in the worktree at a time. Fresh builder sub-agent writes code+tests
(red→green) → SEPARATE fresh cold adversarial reviewer sub-agent reviews the **immutable commit** → builder
consumes + iterates until clean → NEW cold reviewer each round. Reviewers are read-only, scoped to a SHA.
Skills: `superpowers:subagent-driven-development`, `superpowers:test-driven-development`,
`superpowers:requesting-code-review` / `superpowers:receiving-code-review`.

## The work, in order

### Inc 3 Slice 9 — Routing relax (small, mostly mechanical)
Spec: blueprint §Build-sequence line 9 + slice6plus handoff line 71–73. Make `draft`-state stories reachable
on the resume pages (`tell/[storyId]/page.tsx` and the answer resume path); thread `state` onto `DraftInfo`;
add a resume-page test. This is the first slice that makes an `appended`/finished-then-reopened `draft`-state
story user-reachable (today `listOutstandingAnswerDrafts` skips non-`pending_approval`; note Slice 1 already
widened `listOutstandingDrafts` to include `draft`). Keep it to data/routing plumbing — the full phase UI is
Slice 10; a resumed draft may render via the existing composer markup until Slice 10 collapses phases. No
user-facing decision here.

### Inc 3 Slice 10 — StoryComposer phase collapse (the LAST big one; JSX rework)
Spec: blueprint §"Target shape" (3 phases: `no-draft` / `draft` composing / `pending_approval` shrunk) +
§Build-sequence line 10 + RESOLVED DECISION (b) (extract `<ComposingEditor>` NOW; `StoryComposer` becomes a
thin answer/tell wrapper mounting `<ComposingEditor mode="story">`; Inc 4 will mount `mode="intake">`).
**You MUST fix these carried-forward risks/gaps as part of this slice** (all already documented — do not
re-discover, just resolve):
1. **Slice-8 known gap:** the **Finish button currently lives in the review/`pending_approval` markup** and is
   not wired to a live `draft`. Relocate Finish onto the always-mounted **draft-composing** phase so it acts on
   the `draft` state it requires. (Server `finishDraftAction` is already correct and state-guarded.)
2. **Slice-10 forward risks** (blueprint + slice6plus handoff lines 84–93): (i) `finishThreadAction` returns
   server DB prose and the client `history.replace`s it UNCONDITIONALLY → clobbers hand-edits once the editor
   is always-mounted (fix: echo the client `prose`, or skip `history.replace` when `appendedSegment===""`);
   (ii) the client `appended` branch never clears `followUp` state (stale prompt after an append);
   (iii) `resetKey = draft?.storyId` collapses the undo stack at the capture→review boundary once the editor is
   always-mounted, and `useProseHistory` returns a fresh object each render → stale-closure risk for
   `handleStep`/`uploadRecording` (needs a stable per-compose-session history key + a ref/memoized handle).
3. **Deferred rename:** `finishThreadAction` → `declineFollowUpAction` (blueprint line 28; deferred to this
   slice). Update the client caller.
Keep behavior identical to the resolved decisions; do not invent new UX. Where a truly novel micro-decision
appears, take the conservative ADR-consistent default, record it, continue (see AFK rules).

### Inc 3 Slice 11 — Cleanup
Spec: blueprint §Build-sequence line 11 + slice6plus handoff lines 78–82. Delete dead poll infra ONLY IF
unused elsewhere. **Confirmed NOT deletable** (link-session `/s/[token]`): `poll-status.ts`, `answer-status.ts`
(used by `NarratorRecorder.tsx`, `ApprovePending.tsx`, `/api/capture/status/route.ts` via
`pollUntilReady`/`mapStoryStateToStatus`). Re-verify consumers of `AnswerReviewPending.tsx` +
`getAnswerStatusAction` at that point; delete only what has zero remaining consumers. The `ready` ThreadStep
kind: no answer action produces it anymore, but the link-session surface still maps story state to a `ready`
status — verify before removing the variant.

### Increment 4 — Intake unification + memory-extraction placement
Spec: rollout roadmap §Increment 4. Depends on Slice 10's `<ComposingEditor>` extraction. `AboutYouFlow.tsx`
+ its `actions.ts` mount `<ComposingEditor mode="intake">` (append + Cleanup + ✨ Polish + Finish-check) but
stop at anchor extraction at Save; intake audio+transcript retained. Confirm `augmentProfileFromStory` fires
post-approval only for stories (it does) and at Save for intake. Wire the consent-gated narrator-memory
extraction seam as a real call-site (stub/no-op is acceptable per the roadmap) so placement is future-ready.
Tests per the roadmap. RESOLVED DECISION (b) already settled the reuse question (shared `<ComposingEditor>`).

### Increment 5 — Observability, doc-truing, ADR close
Spec: rollout roadmap §Increment 5. Verbose client+server logging across record/type/edit/polish/finish
(server via `plog`; add client `[chronicle]` logs for the capture-state transitions); confirm
`CHRONICLE_PIPELINE_LOG=1` surfaces the sequence. Rewrite `docs/Recording-To-Story-Pipeline.md` to the new
flow. Set `docs/adr/0014-*` Status → Implemented (+ implementation notes); note the ADR-0007 "canonical =
original record" amendment; update `docs/PLAN.md` / `docs/PROGRESS.md`. Retire the "Polishing your words"
copy. **Also update `docs/undone 7-4.md`** (repo root) — its Tier-1 item #1 currently says ADR-0014 is "0%
reachable by any user on master"; once this branch is done that statement becomes "complete on the branch,
pending human merge to master." Do NOT delete the file; correct the entry.

## Pre-resolved decisions (use these — do not ask, do not re-litigate)
- **Finish-check card behavior** (already shipped in Slice 8, keep it in the phase-collapse): inline
  dismissible card; **[Use polished version] = accept** (logPolish + finish on the polished text),
  **X "Keep mine as is" = finish as-is** (decline). Both terminal.
- **Stale-offer invalidation** (shipped Slice 8): editing the prose clears `finishOffer`
  (`useEffect([proseDraft])` functional-updater). Preserve this when the editor becomes always-mounted.
- **`<ComposingEditor>` extraction** (decision b): do it in Slice 10; intake reuses it in Inc 4.
- **Narrator-memory extraction** (Inc 4): model is deferred; land a real call-site as a no-op/stub, not a
  full implementation.
- Any NEW micro-decision → conservative ADR-consistent default + record it; never block.

## Deploy safety (AFK-critical)
The branch is a **preview** only; Vercel auto-deploys to production from **master**, not from this branch
(see memory `project_vercel_beta_deploy`, `project_vercel_git_author_gate`). Slices 9–10 make the surface
user-reachable **on the branch**, which is safe. **Never merge to master or push** — the go-live is a human
decision. If a schema change surfaces, STOP (reseeding both Neon branches is out of AFK scope).

## When you finish (or hit a stop condition)
- Update `project_adr0014_rollout_status.md` and the blueprint Build-status after EACH slice/increment (SHA,
  baselines, what landed, "next").
- At the end, write a short completion note (what's green, final baselines, the human checkpoints that remain:
  merge-to-master go/no-go, Neon reseed if any schema moved, and the Inc-5 human sign-offs). Leave the branch
  committed and green; do not merge.
