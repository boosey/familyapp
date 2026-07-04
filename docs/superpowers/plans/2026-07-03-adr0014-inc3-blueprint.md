# ADR-0014 Inc 3 — Web Composing Surface: Implementation Blueprint (pre-plan)

> Design/mapping notes produced 2026-07-03 to seed the Inc 3 bite-sized TDD plan. Inc 1 (pipeline
> seams) and Inc 2 (core write path) are LANDED in this branch. Inc 3 is a `apps/web` consumption/
> wiring job per frozen-contract §6, plus a small, flagged set of edits OUTSIDE the frozen contract
> (see "Decisions/scope beyond the contract"). Do not start building until the open decisions below
> are resolved.

## Target shape
Collapse today's two mutually-exclusive phases (capture XOR pending-review) into three phases keyed on
**story state**, not on presence/absence of a `draft` prop:
1. `no-draft` — voice⇄text toggle capture entry (≈ today's capture phase, minus review/follow-up branching).
2. `draft` (NEW live composing surface) — `KindredProseEditor` always mounted (Polish + undo/redo) with a
   persistent capture footer (mic + type box, both live), a compact audio-only take-relisten strip, and a
   **Finish** button. Subsumes today's review editor markup AND today's capture markup — one screen.
3. `pending_approval` (shrunk) — confirm title + tier + Share/Discard; optional Polish; no live append.

The "Polishing your words" poll gate is ELIMINATED (not relocated): each per-take append is one
synchronous server-action round-trip returning the new prose. `AnswerReviewPending` / `pollUntilReady`
/ `getAnswerStatusAction` lose their only capture-path caller.

## Server-action surface after Inc 3 (answer/[askId]/actions.ts)
- `composeStoryAction` — text branch: `ingestTextStory` → `appendTypedTakeContribution(priorProse=null)`.
  New `ThreadStep` variant `{ kind: "appended"; storyId; prose; appendedSegment }` replaces `ready`.
- `recordAnswerAction` — voice: `ingestRecording` → `transcribeTakeToRecording` → `cleanupTake` →
  `appendVoiceTakeContribution(priorProse=<client editor text>)` → (flag) `runFollowUpStep`. Returns `appended`.
- `recordFollowUpTakeAction` — same voice chain; FormData gains required `prose` (client's current text).
- `finishThreadAction` → RENAME `declineFollowUpAction`; decline = append `skipped` outcome, no transition, drops `stitchAndRenderStory`.
- `dropTakeAction` — drop take-0 = discard thread; drop take N = `dropStoryRecording` only, **prose untouched** (no re-stitch).
- `polishAnswerProseAction` — gains `storyId`; now PERSISTS: `polishProse` → `logPolish`.
- `finishDraftAction` (NEW) — Finish-check → `deriveMetadata` → `finishDraft` (draft→pending_approval).
- `shareAnswerAction`, `discardAnswerAction` — unchanged (both already accept the relevant states).

**Load-bearing:** every append action must accept the CLIENT's current editor text as `priorProse` in
FormData (§6 step 4/5). The server concatenates onto the client's text, never a fresh DB read of
`stories.prose` — this is what makes append non-clobbering of in-flight hand-edits. Test explicitly.

## Client append/reconcile (§6 step 5)
On stop-record / Continue: post `FormData{ audio|text, prose: proseDraft, storyId? }` → server returns
`{ prose, appendedSegment }` → client calls `history.replace(response.prose)` (one undoable step).
**Required small wiring change:** lift `useProseHistory` from inside `KindredProseEditor` up into
`StoryComposer` (or add an imperative append handle) so the parent can trigger `.replace` on take-append
(an event the editor doesn't emit today). `historyKey` must stay `storyId`-keyed (NOT per-take) or undo
history wipes on every append.

## Build sequence (vertical slices, each independently testable)
> **RESEQUENCED 2026-07-03 (product owner approved):** Slice 1's `createTextDraft` dedup was found to be
> coupled to Slice 4 — dropping the `transcript` write breaks the still-wired old text-render path
> (`composeStoryAction → dispatchPipeline`, which renders prose from `stories.transcript`) and
> `text-story-pipeline.test.ts`, leaving the suite red across commits 1→3. So Slice 1 is now the
> `listOutstandingDrafts` widen ONLY; the `createTextDraft` `user_authored`+`transcript` removal moved
> into Slice 4, where the compensating `appendTypedTakeContribution` wiring, `dispatchPipeline` removal,
> and `text-story-pipeline.test.ts` retirement land atomically (suite stays green). Bar per commit is
> `pnpm -r test` + `pnpm -r typecheck` green — NOT an integrated-working UI (the new surface is not
> user-reachable until the routing/phase-collapse slices 9–10).
1. Contract-fixing core edit (blocking, tiny): widen `listOutstandingDrafts` filter to `['draft','pending_approval']`.
   (The `createTextDraft` dedup originally bundled here moved to Slice 4 — see resequence note above.)
2. `polishAnswerProseAction` → persisting Polish (`storyId` + `logPolish`) + regression test. Cheapest win; do first.
3. Voice per-take append in `recordAnswerAction` (drop `dispatchPipeline`; add `cleanupTake`+`appendVoiceTakeContribution`), server-only.
4. Typed per-take append in `composeStoryAction` text branch. NOW ALSO carries the Slice 1 `createTextDraft`
   dedup (drop `user_authored` row + `transcript` write) + removes `dispatchPipeline` from the text branch +
   retires/rewrites `text-story-pipeline.test.ts` and fixes `composing-write-path.test.ts`/`text-draft.test.ts`
   assertions atomically. Each out-of-contract edit ships a regression test.
5. Client editor lift + append wiring; delete poll/`AnswerReviewPending`; rename `ready`→`appended`.
6. Follow-up loop restaging: drop `stitchAndRenderStory`; degrade = "stop proposing, return to draft".
7. `dropTakeAction` = audio-only, no re-stitch (behavior change + test + sign-off).
8. Finish + Finish-check (`finishDraftAction`) — riskiest slice, depends on decision (a). Keep last/small.
9. Routing relax: `tell/[storyId]/page.tsx` accepts `draft`; thread `state` onto `DraftInfo`; resume-page test.
10. `StoryComposer` phase collapse (JSX rework) — LAST, once actions speak the new contract. Optionally extract `<ComposingEditor>` (decision b).
11. Cleanup: delete dead poll infra (`answer-status.ts`, `poll-status.ts`, `AnswerReviewPending.tsx`) if unused elsewhere (verify `NarratorRecorder`).

## Build status (updated 2026-07-04, through Slice 5)
LANDED, each full-suite green: Slice 2 `eb01b87` (Polish persist) · Slice 1 `e10b61a` (listOutstandingDrafts
widen + `state` field + Questions-tab contract preserved at wrapper AND hub) · Slice 3 `74c9a8e` (voice
per-take append, flag-off/self-initiated one-shot branch only; adds `appended` ThreadStep; extends
`transcribeTakeToRecording` to return `modelId`) · Slice 4 `d12e4e1` (typed per-take append + `createTextDraft`
dedup + retired old text-render pipeline path) · Slice 5 `a9f2699` (client editor lift: `useProseHistory` lifted
from `KindredProseEditor` into `StoryComposer`, editor gains optional injected `history?` prop; `handleStep`
handles `kind==="appended"` with `history.replace(prose)` + refresh + NO poll; follow-up append posts client
`prose` as priorProse — forward-plumb, inert until Slice 6; lifted-history resetKey is `draft?.storyId` NOT
`activeStoryId ?? …` per cold-review Medium fix + hook regression test). Baselines now: core 274, pipeline 74,
capture 38, apps/web **371**, typecheck exit 0. Core barrel exports `appendVoiceTakeContribution` +
`appendTypedTakeContribution` (**`finishDraft` still NOT exported — Slice 8 must add it**).

✅ **DEPLOY SAFETY (was ⚠️; resolved by Slice 5):** `StoryComposer.handleStep` now handles `kind==="appended"`
(no poll) — the false "taking longer" after every capture is gone. The `ready`/poll branch is KEPT (still
produced by the flag-on follow-up paths + `dropTakeAction`, restaged in Slices 6/7). The branch is STILL not
user-reachable end-to-end: after `appended` the story stays `draft`, and `listOutstandingAnswerDrafts` skips
non-`pending_approval`, so `router.refresh()` yields `draft=null` → capture phase. Reachability lands with
Slice 9 (routing relax) + Slice 10 (phase collapse). Per-commit bar stays `pnpm -r test`+`typecheck` green,
NOT integrated UI.

**Slice 5 handoff corrections (supersede earlier deletion assumptions):** `poll-status.ts` + `answer-status.ts`
are NOT deletable — the link-session surface `/s/[token]` (`NarratorRecorder.tsx`, `ApprovePending.tsx`) and
`/api/capture/status/route.ts` still consume `pollUntilReady` / `mapStoryStateToStatus`; Slice 11's "if unused
elsewhere (verify NarratorRecorder)" gate = KEEP them. `getAnswerStatusAction` + `AnswerReviewPending` stay too
(flag-on `ready` path + in-flight screen). **Slice 10 forward risk:** once the composing editor is always-mounted
across appends (no page remount at the capture→review boundary), `resetKey=draft?.storyId` will STILL collapse
the undo stack at that boundary, and the fresh `history` object identity each render makes
`handleStep`/`uploadRecording` a live stale-closure risk — the resetKey/handoff model needs rework in Slice 10.

📌 **Deferred (RESOLVED DECISION c, not yet done):** `shareAnswerAction`'s `augmentProfileFromStory` still
reads `approved.transcript`, which is NULL for new-model stories → augmentation silently no-ops (best-effort,
swallowed). Switch the source to `approved.prose` (ships with a regression test). Latent until a story first
reaches `pending_approval` via the new Finish path (Slice 8). **Owner-decided 2026-07-04: FOLD INTO SLICE 8**
(not Slice 5) — it only becomes live once Finish creates a new-model `pending_approval` story.

## RESOLVED DECISIONS (product owner, 2026-07-03)
- **(a) Finish-check = REUSE `polishProse`.** At Finish, run `polishProse` speculatively on finalText; if the
  result materially differs from the input (normalized diff), present it as the offer with its output as the
  preview. Accept ⇒ `logPolish` with the already-computed result (0 extra LLM calls). Decline ⇒ `finishDraft`
  as-is. No new pipeline seam, no contract amendment. **UX: inline dismissible card** above the Finish button
  (not a modal). Over-triggering on merely-rambly prose is accepted as correct per ADR §2.
- **(b) Extract `<ComposingEditor>` NOW** during the phase-collapse (slice 10). `StoryComposer` becomes a thin
  wrapper (answer/tell chrome) mounting `<ComposingEditor mode="story" …>`; Inc 4's `AboutYouFlow` will mount
  `<ComposingEditor mode="intake" …>` directly.
- **(c) Out-of-contract edits APPROVED** (each ships with a regression test): `createTextDraft` dedup (stop
  double-logging typed take-0 + drop the `transcript` write); `listOutstandingDrafts` widen to
  `['draft','pending_approval']`; retire `stitchAndRenderStory` from `answer/[askId]/actions.ts`;
  `shareAnswerAction` switch `augmentProfileFromStory` source `approved.transcript` → `approved.prose`.
- **(d) Drop-take = remove AUDIO + keep text + toast.** Dropping a follow-up take deletes the recording, leaves
  its words in the editor, and shows a toast: "Recording removed — edit the text above to remove those words
  too." (Dropping take-0 still discards the whole draft, unchanged.)

## Risks / gotchas
- `priorProse` must travel with every append (else concurrent hand-edit clobbered — the exact bug ADR-0014 fixes).
- `stories.transcript` goes null for new-model stories once monolithic render retires → fix `shareAnswerAction`'s `augmentProfileFromStory` source to `prose`.
- Editor stays mounted across appends (no remount-per-take); keep `historyKey` = storyId.
- Audio-take order (`story_recordings.position`) and prose order (`prose_revisions.seq`) are independently correct — do NOT force visual alignment.
- Test-harness gap: no test drives two sequential appends on one story. Add voice→typed→voice and typed-first→voice (kind flips exactly once).
- `polishAnswerProseAction` signature change: wholesale-mocked tests pass silently; only unmocked server-integration tests catch it.
