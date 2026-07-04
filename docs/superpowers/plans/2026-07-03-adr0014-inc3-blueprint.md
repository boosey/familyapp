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
1. Contract-fixing core edits (blocking, tiny): widen `listOutstandingDrafts` filter to `['draft','pending_approval']`;
   strip `createTextDraft`'s redundant `user_authored` row + `transcript` write. Update the text-story assertion.
2. `polishAnswerProseAction` → persisting Polish (`storyId` + `logPolish`) + regression test. Cheapest win; do first.
3. Voice per-take append in `recordAnswerAction` (drop `dispatchPipeline`; add `cleanupTake`+`appendVoiceTakeContribution`), server-only.
4. Typed per-take append in `composeStoryAction` text branch (depends on #1).
5. Client editor lift + append wiring; delete poll/`AnswerReviewPending`; rename `ready`→`appended`.
6. Follow-up loop restaging: drop `stitchAndRenderStory`; degrade = "stop proposing, return to draft".
7. `dropTakeAction` = audio-only, no re-stitch (behavior change + test + sign-off).
8. Finish + Finish-check (`finishDraftAction`) — riskiest slice, depends on decision (a). Keep last/small.
9. Routing relax: `tell/[storyId]/page.tsx` accepts `draft`; thread `state` onto `DraftInfo`; resume-page test.
10. `StoryComposer` phase collapse (JSX rework) — LAST, once actions speak the new contract. Optionally extract `<ComposingEditor>` (decision b).
11. Cleanup: delete dead poll infra (`answer-status.ts`, `poll-status.ts`, `AnswerReviewPending.tsx`) if unused elsewhere (verify `NarratorRecorder`).

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
