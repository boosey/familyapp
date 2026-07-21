# ADR-0014 Inc 3 — Handoff: Slice 8 and subsequent slices (2026-07-04)

You are continuing the **web composing-surface** rework (ADR-0014 Increment 3) in an existing git worktree.
Slices 2, 1, 3, 4, 5, 6, **7** are landed green. Your job is **Slice 8 onward** (8 → 11). **Slice 8 is the
riskiest slice** (the blueprint says so) — go slow, TDD, cold-review.

## Read these first (authoritative — supersede this doc on conflict; do NOT duplicate them here)
- **Blueprint** `docs/superpowers/plans/2026-07-03-adr0014-inc3-blueprint.md` — the 11-slice build sequence, the
  **"Build status"** section (now current **through Slice 7**), **RESOLVED DECISIONS (a)-(d)**, Risks/gotchas.
  This is your slice-by-slice spec. Slice 8's spec = §Build sequence line 8 + §RESOLVED DECISION (a) + decision (c).
- **Frozen shared contract** `docs/superpowers/plans/2026-07-03-adr0014-shared-contract.md` (§4 core signatures, §6
  orchestration). Do NOT renegotiate the contract in a slice plan — stop and amend that doc first if a slice needs it.
- **Prior handoff** `docs/superpowers/plans/2026-07-04-adr0014-inc3-slice6plus-handoff.md` — still accurate for
  Slices 9/10/11 details and the Slice-10 forward risks. This doc only supersedes its "Slice 6/7 = NEXT" framing.
- `CLAUDE.md` (root) — single-front-door rule, vendor-seam rule, subagent-driven workflow.
- Persistent memory `project_adr0014_rollout_status.md` — up to date through Slice 7.

## Environment / worktree (cwd resets — always absolute-cd)
- Worktree: `C:/Users/boose/projects/familyapp/.claude/worktrees/composing-surface-inc1-3`
  (branch `worktree-composing-surface-inc1-3`). **HEAD = `39bd5e7`** (docs) on top of **`5eb4a8d`** (Slice 7 code).
- Prefix EVERY shell command: `cd "C:/Users/boose/projects/familyapp/.claude/worktrees/composing-surface-inc1-3" && …`
- Windows/PowerShell primary; Bash tool available. `pnpm -r test`, `pnpm -r typecheck`. Single web file:
  `pnpm --filter @chronicle/web exec vitest run <path>`. Single core file:
  `pnpm --filter @chronicle/core exec vitest run <path>`. DB tests use in-process PGlite (no external PG).
- **Commit-author gate (Vercel):** commits MUST be authored by `Alex Boudreaux <boosey.boudreaux@gmail.com>`
  (repo-local already set — verify `git config user.email`). Use `--author=` on `git commit` to be safe.

## Method (repo-mandated — CLAUDE.md §Workflow + global prefs)
- **Subagent-driven TDD, one slice at a time.** A fresh builder sub-agent writes code+tests (red→green); then a
  SEPARATE fresh cold adversarial reviewer sub-agent reviews the **immutable commit**; builder consumes + iterates
  until clean. Spin up a NEW cold reviewer each round. Only ONE writer in the worktree at a time; reviewers read-only.
- **Sub-agents tend to go idle without a prose report and can over-claim green — VERIFY YOURSELF.** After each
  builder finishes: `git show --stat`, run `pnpm -r typecheck` + the affected suites (and the full `apps/web` suite)
  yourself before trusting the count.
- Per-commit bar = `pnpm -r test` + `pnpm -r typecheck` GREEN. **NOT integrated/user-reachable UI** — the surface is
  not user-reachable until Slices 9–10 (routing relax + phase collapse). Commit per slice.
- After each bug fix, a companion regression test (global pref).
- **Do NOT push or merge without asking the user.** Slices that are behavior changes need product-owner sign-off —
  use `AskUserQuestion` to confirm the genuinely-open micro-decisions BEFORE building (see how Slices 6/7 did it).

## Current baselines (post-Slice-7, verified independently)
core **277**, pipeline **74**, capture **38**, apps/web **378**, `pnpm -r typecheck` exit 0.
Core barrel (`packages/core/src/index.ts`) exports `appendVoiceTakeContribution` + `appendTypedTakeContribution`.
Pipeline barrel exports `polishProse`, `cleanupTake`, `deriveMetadata`.

## Slice 8 — Finish + Finish-check (`finishDraftAction`) — riskiest. Behavior change → sign-off.
Depends on **RESOLVED DECISION (a)** (blueprint) and folds in deferred **decision (c)**. Precise scope:

1. **Add `finishDraft` to the core barrel.** It EXISTS at `packages/core/src/story-repository.ts:1182` but is NOT
   re-exported from `packages/core/src/index.ts` (grep confirms only the append fns are). Signature:
   `finishDraft(db, { storyId, ownerPersonId, finalText, metadata: { title, summary, tags } }) => Promise<Story>`
   (draft → pending_approval; it goes through `assertStoryTransition`). Add the export.
2. **New `finishDraftAction`** in `apps/web/app/hub/answer/[askId]/actions.ts`. Per DECISION (a) the Finish-check
   REUSES `polishProse` — NO new pipeline seam, NO contract amendment:
   - Auth (account) + ownership + `state === 'draft'` guard via the front door (mirror the other actions).
   - Run `polishProse(languageModel, { prose: finalText, promptQuestion })` **speculatively** on the client's
     current finalText. If the result **materially differs** (normalized diff — decide the normalization; whitespace-
     insensitive compare is the obvious choice) from the input, return it as an **offer** `{ kind: "finish_offer",
     storyId, polished }` (or similar) so the client can show the inline dismissible card. If it does NOT materially
     differ (or `polishProse` returns `modelId === ""` = empty/no-model no-op), skip the offer and finish directly.
   - **Accept path:** the client re-invokes with an "accept" signal + the already-computed polished text → the action
     `logPolish` (persist the `ai_polished` revision + `stories.prose`) using the ALREADY-COMPUTED result — **0 extra
     LLM calls** (do NOT re-run polishProse on accept). Then `deriveMetadata(languageModel, { fullText })` →
     `finishDraft(db, { …, finalText: <polished>, metadata })`.
   - **Decline path:** `deriveMetadata` on the finalText as-is → `finishDraft` as-is (no logPolish).
   - `finishDraft` transitions draft → pending_approval. On success the client `router.refresh()` surfaces the
     pending_approval review phase (once Slice 9 routing relax lands; today `listOutstandingAnswerDrafts` still only
     surfaces pending_approval, so a Finished story WILL now appear — sanity-check the Questions/Stories tab query).
   - **priorProse discipline:** Finish must operate on the CLIENT's current editor text (posted in FormData), never a
     fresh DB read of `stories.prose` — same non-clobbering rule as the append actions (blueprint §Load-bearing).
   - **UX (DECISION a):** inline dismissible card above the Finish button, NOT a modal. Over-triggering on merely-
     rambly prose is accepted as correct per ADR §2.
   - The exact `ThreadStep`/return shapes for the offer/accept/decline round-trip are a genuine open micro-decision —
     **ask the user** (as Slices 6/7 did) before building.
3. **FOLD IN deferred DECISION (c):** in `shareAnswerAction` (`apps/web/app/hub/answer/[askId]/actions.ts`), switch
   the `augmentProfileFromStory` source from `approved.transcript` → `approved.prose`. The relevant lines are
   ~575–581 (`if (approved?.transcript)` / `augmentProfileFromStory(approved.transcript, …)`). Rationale:
   `stories.transcript` is NULL for new-model (append-built) stories, so augmentation silently no-ops today; it only
   becomes LIVE once Finish (this slice) creates a new-model `pending_approval` story. Ship a **regression test**:
   a new-model story (transcript NULL, prose set) → share → augmentation reads `prose` and runs.
4. **Client (`apps/web/app/hub/StoryComposer.tsx`):** wire a **Finish** button on the composing/review surface that
   posts the current prose to `finishDraftAction`, renders the inline dismissible Finish-check card on `finish_offer`
   (accept → re-invoke with the polished text; dismiss → decline/finish as-is). Keep it MINIMAL and consistent with
   the Slice-6/7 "server + minimal functional client" scoping — the full phase collapse is Slice 10. Add any copy to
   the `hub.answer.*` module in `apps/web/app/_copy/hub.ts` (no inline strings). NOTE the Slice-10 forward risks
   already recorded (below) — do not regress them.
5. **Tests:** server-integration tests for finishDraftAction (offer-when-materially-different, no-offer-when-not,
   accept ⇒ logPolish + finishDraft + 0 extra LLM calls [assert the LLM mock call count], decline ⇒ finishDraft as-is,
   auth/ownership/non-draft-state rejcontaining) + the decision-(c) share regression + a client test for the card.
   Use the existing `answer-follow-up-loop.server.test.ts` harness style (mocked `@/lib/runtime`, scripted LLM).

## Gotchas carried forward (verified this session)
- **`stitchAndRenderStory` is GONE from `apps/web`** (only in `packages/pipeline` now). The `ready` ThreadStep
  variant, `getAnswerStatusAction`, and the poll infra (`poll-status.ts`, `answer-status.ts`, `AnswerReviewPending`)
  are KEPT but **no answer action produces `ready` anymore** — the link-session `/s/[token]` surface
  (`NarratorRecorder.tsx`, `ApprovePending.tsx`, `/api/capture/status/route.ts`) still uses `pollUntilReady`/
  `mapStoryStateToStatus`, so do NOT delete them until Slice 11 (re-verify consumers then).
- **`prose_revisions` is append-only** — the BEFORE-UPDATE trigger (`packages/db/drizzle/invariants.sql`) forbids ALL
  UPDATEs; DELETE is allowed ONLY when the story has no `consent_records` (pre-consent draft/pending_approval).
  `logPolish` appends a NEW row (never edits). Keep that in mind for any lineage work.
- **finishThreadAction (decline) keeps its name** — the blueprint's rename to `declineFollowUpAction` is DEFERRED to
  Slice 10. It returns `{kind:"appended", prose: <server DB prose>, appendedSegment: ""}` today.
- **Slice-10 forward risks (do NOT ship live before Slice 10; recorded in the blueprint Build-status):**
  (i) `finishThreadAction` returns server DB prose and the client `history.replace`s it UNCONDITIONALLY → clobbers
  hand-edits once the editor is mounted during the follow-up screen (fix: echo client `prose`, or skip `history.replace`
  when `appendedSegment === ""`). (ii) the client `appended` branch never clears `followUp` state (stale prompt after
  an append). (iii) `resetKey = draft?.storyId` collapses the undo stack at the capture→review boundary once the
  editor is always-mounted; `useProseHistory` returns a fresh object each render → stale-closure risk for
  `handleStep`/`uploadRecording`. All three fold into the Slice-10 phase collapse.

## Slices after 8 (from the blueprint — details in the prior slice6plus handoff)
9. **Routing relax:** `tell/[storyId]/page.tsx` (+ answer page) accept `draft` state; thread `state` onto `DraftInfo`;
   resume-page test. First makes an `appended` story user-reachable.
10. **`StoryComposer` phase collapse (JSX rework)** — LAST big one. Collapse capture-XOR-review into the 3-phase
    state-driven surface; extract `<ComposingEditor>` (DECISION b, Inc 4 intake reuses it). Handle the 3 forward risks.
11. **Cleanup:** delete dead poll infra ONLY IF unused elsewhere. `poll-status.ts` + `answer-status.ts` NOT deletable
    (link-session). Re-verify `AnswerReviewPending.tsx` + `getAnswerStatusAction` consumers before deleting.

## Suggested skills for the next session
- `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) — run the builder/reviewer loop.
- `superpowers:test-driven-development` — each slice is TDD.
- `superpowers:requesting-code-review` / `superpowers:receiving-code-review` — fresh-reviewer discipline.
- Use `AskUserQuestion` to confirm the finish offer/accept/decline return-shape micro-decision BEFORE building.

## Memory
Update `project_adr0014_rollout_status.md` as Slice 8 lands (baselines, `finishDraft` now in barrel, decision-(c)
done, HEAD sha, "slice 9 next").
