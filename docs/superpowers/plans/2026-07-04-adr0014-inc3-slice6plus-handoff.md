# ADR-0014 Inc 3 — Handoff: Slice 6 and subsequent slices (2026-07-04)

You are continuing the **web composing-surface** rework (ADR-0014 Increment 3) in an existing git
worktree. Slices 2, 1, 3, 4, **5** are landed green. Your job is **Slice 6 onward** (6 → 11).

## Read these first (authoritative — do NOT duplicate, they supersede this doc on conflict)
- Frozen shared contract: `docs/superpowers/plans/2026-07-03-adr0014-shared-contract.md` (esp. §4 core
  signatures, §6 capture-action orchestration). **Do not renegotiate the contract in a slice plan — stop
  and amend that doc first if a slice needs a change.**
- Inc 3 blueprint: `docs/superpowers/plans/2026-07-03-adr0014-inc3-blueprint.md` — the **11-slice build
  sequence** (§"Build sequence"), the **"Build status"** section (updated through Slice 5), the
  **RESOLVED DECISIONS (a)-(d)**, and **Risks/gotchas**. This is your slice-by-slice spec.
- Repo conventions + the single-front-door rule + subagent workflow: `CLAUDE.md` (root).

## Environment / worktree (important — cwd resets)
- Worktree: `C:/Users/boose/projects/familyapp/.claude/worktrees/composing-surface-inc1-3`
  (branch `worktree-composing-surface-inc1-3`). HEAD after Slice 5 = **`c0df3d4`** (docs) on top of
  **`a9f2699`** (Slice 5 code).
- Your shell may open in a DIFFERENT worktree and cwd may reset each command. ALWAYS prefix commands with
  an absolute cd: `cd "C:/Users/boose/projects/familyapp/.claude/worktrees/composing-surface-inc1-3" && …`
- Windows / PowerShell primary; Bash tool available. `pnpm -r test`, `pnpm -r typecheck`. Single web file:
  `pnpm --filter @chronicle/web exec vitest run <path>`. DB tests use in-process PGlite (no external PG).
- **Commit-author gate (Vercel):** commits MUST be authored by `Alex Boudreaux <boosey.boudreaux@gmail.com>`
  (already set repo-local in this worktree — verify with `git config user.email`).

## Method (repo-mandated — see CLAUDE.md §Workflow + global prefs)
- **Subagent-driven TDD, one slice at a time.** Fresh builder sub-agent writes code+tests (red→green);
  then a SEPARATE fresh cold adversarial reviewer sub-agent reviews the **immutable commit**; builder
  consumes the review and iterates until clean. **Spin up a NEW cold reviewer each round.**
- **Only ONE writer in the worktree at a time.** Run reviewers read-only, scoped to a specific commit.
- Per-commit bar = `pnpm -r test` + `pnpm -r typecheck` GREEN (NOT integrated/working UI — the surface is
  not user-reachable until Slices 9–10). Commit per slice.
- After each bug fix, write a companion regression test (global pref).
- **Do NOT push or merge without asking the user.** Named-agent sub-agents in this session tend to go idle
  WITHOUT delivering a prose report — don't wait on it; inspect the working tree / run the suite yourself.

## Current baselines (post-Slice-5)
core **274**, pipeline **74**, capture **38**, apps/web **371**, `pnpm -r typecheck` exit 0.
Core barrel exports `appendVoiceTakeContribution` + `appendTypedTakeContribution`.
**`finishDraft` is NOT yet in the core barrel — Slice 8 must add it** (it exists in
`packages/core/src/story-repository.ts`, just not re-exported from `packages/core/src/index.ts`).

## State of the key files (what Slice 5 left)
- `apps/web/app/hub/answer/[askId]/actions.ts` — the server-action surface. `ThreadStep` union has BOTH
  `appended` (flag-off / typed / voice take-0) AND `ready` (flag-on follow-up paths + `dropTakeAction`).
  `runFollowUpStep`, `recordFollowUpTakeAction`, `finishThreadAction`, `dropTakeAction` still call
  `stitchAndRenderStory` (the OLD monolithic render) and return `ready`.
- `apps/web/app/hub/StoryComposer.tsx` — `handleStep` has an `appended` branch (no poll) AND the `ready`
  branch (polls `getAnswerStatusAction`/`pollUntilReady`). `useProseHistory` is lifted here; the review
  editor gets `history={history}`. Follow-up append already posts `form.append("prose", proseDraft)`
  (priorProse) — but the SERVER does not read it yet (that's Slice 6).
- `apps/web/app/_kindred/KindredProseEditor.tsx` — optional injected `history?: ProseHistory` prop.

## Slices remaining (from the blueprint §Build sequence)
6. **Follow-up loop restaging (NEXT).** Drop `stitchAndRenderStory` from the answer actions; a follow-up
   voice take becomes an APPEND (`recordFollowUpTakeAction` → `appendVoiceTakeContribution` with
   `priorProse` = the client `prose` FormData field Slice 5 already posts). Degrade path = "stop proposing,
   return to draft" (NOT stitch-and-finish). `finishThreadAction` (decline) = append `skipped` outcome, no
   transition, no stitch (blueprint line ~28). This is where the `ready` kind starts being retired on the
   follow-up path — but keep whatever `ready`/poll usage other still-live paths need until they're migrated.
   Behavior change → regression tests + (per blueprint) sign-off.
7. **`dropTakeAction` = audio-only, no re-stitch** (RESOLVED DECISION d: drop follow-up take removes the
   recording, KEEPS its text in the editor, shows a toast; dropping take-0 still discards the whole draft).
   Behavior change + test + sign-off.
8. **Finish + Finish-check (`finishDraftAction`)** — riskiest. Depends on RESOLVED DECISION (a): Finish-check
   REUSES `polishProse` speculatively, inline dismissible offer card, accept ⇒ `logPolish` with the
   already-computed result (0 extra LLM calls). MUST **add `finishDraft` to the core barrel**. Also FOLD IN
   the deferred **decision-(c) `shareAnswerAction` fix**: switch `augmentProfileFromStory` source
   `approved.transcript` → `approved.prose` (+regression test) — it only goes live once Finish creates a
   new-model `pending_approval` story (owner-decided 2026-07-04 to land here, not Slice 5).
9. **Routing relax:** `tell/[storyId]/page.tsx` (and the answer page path) accept `draft` state; thread
   `state` onto `DraftInfo`; resume-page test. This is what first makes an `appended` story user-reachable
   (today `listOutstandingAnswerDrafts` skips non-`pending_approval`).
10. **`StoryComposer` phase collapse (JSX rework)** — LAST big one. Collapse capture-XOR-review into the
    3-phase state-driven surface (no-draft / draft-composing / pending_approval). Extract `<ComposingEditor>`
    (RESOLVED DECISION b) — thin `StoryComposer` wrapper mounting `<ComposingEditor mode="story">`; Inc 4
    intake reuses it. **⚠️ Slice-10 forward risk flagged in Slice 5** (see below).
11. **Cleanup:** delete dead poll infra ONLY IF unused elsewhere. **Verified during Slice 5: `poll-status.ts`
    + `answer-status.ts` are NOT deletable** (link-session `/s/[token]` `NarratorRecorder.tsx` +
    `ApprovePending.tsx` + `/api/capture/status/route.ts` use `pollUntilReady`/`mapStoryStateToStatus`).
    Candidates that MIGHT be deletable once the `ready` path is fully gone: `AnswerReviewPending.tsx`,
    `getAnswerStatusAction` (re-verify no consumers at that point).

## ⚠️ Slice-10 forward risk (surfaced by the Slice 5 cold review — handle in Slice 10, NOT before)
Once the composing editor is **always-mounted across appends** (no page remount at the capture→review
boundary), two things that are dormant today go live:
1. `resetKey = draft?.storyId` will STILL collapse the undo stack at the capture→review transition
   (`undefined → storyId`). The resetKey/history-handoff model needs rework then (a stable per-compose-session
   key that survives the "no id → id" first-take transition).
2. `useProseHistory` returns a NEW object every render, so `handleStep`/`uploadRecording` (which now depend on
   `history`) churn identity each render → a live stale-closure risk for `mr.onstop → uploadRecording`.
   Consider a ref-based/memoized history handle. See the inline comment near the lifted `useProseHistory` call
   in `StoryComposer.tsx` and the hook hazard pinned in `apps/web/__tests__/use-prose-history.test.tsx`.

## Suggested skills for the next session
- `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) — to run the builder/reviewer loop.
- `superpowers:test-driven-development` — each slice is TDD.
- `superpowers:requesting-code-review` / `superpowers:receiving-code-review` — the fresh-reviewer discipline.
- Slices 6/7 are behavior changes requiring sign-off; use `AskUserQuestion` to confirm before implementing
  where the blueprint says "sign-off."

## Open decisions carried forward
None blocking Slice 6. Decisions (a)-(d) are RESOLVED (blueprint §RESOLVED DECISIONS). The only deferred
work item is decision-(c) `shareAnswerAction` fix → **fold into Slice 8**.

## Memory
The persistent memory file `project_adr0014_rollout_status.md` is up to date through Slice 5 (HEAD `a9f2699`,
Slice 6 next), including the handoff corrections above. Update it as each slice lands.
