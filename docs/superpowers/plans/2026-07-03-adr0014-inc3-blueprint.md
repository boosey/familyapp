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

## Build status (updated 2026-07-04, through Slice 11 — Inc 3 COMPLETE)
**Slice 11 LANDED — dead in-hub poll infra removed, cold-reviewed clean (safe deletion, no findings).
Full suite green: core 277, pipeline 74, capture 38, db 67, apps/web 403, typecheck 0.** HEAD `a61d804`.
Removed (zero remaining consumers after the slice-10 phase collapse): the `{kind:"ready"}` `ThreadStep`
variant, `getAnswerStatusAction` + `AnswerStatusActionResult` + the orphaned `mapStoryStateToStatus`/
`AnswerStatusResult` imports in `answer/[askId]/actions.ts`, the unused `AnswerStatusResult` interface in
`lib/answer-status.ts`, and the dead `getAnswerStatusAction` test blocks/mocks/assertions. KEPT (verified
live link-session `/s/[token]` consumers): `lib/poll-status.ts` (`pollUntilReady` → ApprovePending/
NarratorRecorder), `lib/answer-status.ts` (`mapStoryStateToStatus`/`AnswerStatus` → `/api/capture/status`
route + poll-status), and `AnswerReviewPending.tsx` (composing take-0 in-flight screen). The route maps
state to a `"ready"` STRING (distinct type) — unaffected.

**Inc 3 is now COMPLETE (slices 1–11 all landed green).** Remaining ADR-0014 work: Increment 4 (intake
unification — mount `<ComposingEditor>` in `AboutYouFlow`) and Increment 5 (observability, doc-truing, ADR
close). Both are OUT of this run's scope (user scoped this session to slices 10–11). Also DEFERRED from
slice 10: the core `logPolish` priorProse/staleness guard (frozen-contract/Inc-2 territory — a hardening
follow-up, not a blocker; the client mutation lock closes the single-client UI-reachable clobber).

## Build status (updated 2026-07-04, through Slice 10)
**Slice 10 LANDED — the phase collapse (the LAST big one), full-faithful build, cold-reviewed clean over
4 rounds. Full suite green: core 277, pipeline 74, capture 38, db 67, apps/web 407, typecheck 0.** HEAD
`74fba8c`. Commits: `2618eba` (base: 3-phase collapse + `<ComposingEditor>` extraction) → `2dcdcd2`,
`2149670`, `01d0761`, `74fba8c` (four rounds of cold-review fixes/hardening).

**What landed.** `StoryComposer` is now a thin answer/tell chrome wrapper mounting the new
`apps/web/app/hub/ComposingEditor.tsx` (RESOLVED DECISION (b); Inc 4's intake reuses it). Three phases
keyed on story STATE, not draft presence:
- `no-draft` — voice⇄text capture entry (take 0). The take-0 in-flight window keeps the full-screen
  `AnswerReviewPending` ("Polishing…") screen.
- `draft` (composing) — the NEW live surface: the prose editor is ALWAYS mounted (undo/redo + ✨Polish)
  with a persistent capture footer (mic + type box, both live → append takes), a per-take relisten strip
  (drop on follow-up takes), an inline follow-up banner, and the RELOCATED Finish button + Finish-check card.
- `pending_approval` — shrunk review: title + relisten + edit(+Polish) + tier + Share/Discard.

**Forward-risks / gaps resolved (all documented pre-build):** (1) Finish relocated onto the composing
surface (slice-8 gap). (2) forward-risk (i): `declineFollowUpAction` (renamed from `finishThreadAction`)
echoes the client prose + empty segment; the client skips `history.replace` on an empty segment AND does
not refresh → decline never clobbers hand-edits. (3) forward-risk (ii): the `appended` handler clears the
follow-up banner. (4) forward-risk (iii): `useProseHistory` returns a MEMOIZED handle (stable identity).

**New server action (spec gap the handoff missed):** `appendTypedTakeAction` — a typed take onto an
EXISTING draft (the footer's "type box, live" for take ≥ 1; `composeStoryAction` only ever creates take 0).
Reuses `appendTypedTakeContribution`; no schema/contract change. The `follow_up` `ThreadStep` variant now
carries `prose`/`appendedSegment` so a take-0 follow_up seeds the mounted editor optimistically.

**AFK state-model micro-decisions (recorded):** the composing surface is server-draft-prop driven; the ONLY
remount is no-draft→draft at take 0 (re-seeding from `draft.prose` is correct there); within a session the
storyId is stable so appends + the draft→pending_approval boundary do NOT remount (unsaved edits never
remounted away). take-0→`follow_up` stays client-optimistic (no refresh). `/hub/tell` (fresh, no ask/story
id in its URL) hands off to the resume URL `/hub/tell/[storyId]` on the first take via a `resumeHref`;
`/hub/answer/[askId]` re-queries by askId so it just refreshes (preserving the follow-up banner).
`FollowUpPrompt.tsx` deleted (replaced by the inline banner). "Re-record" retired from review.
`hub.answer.finishing`/`takingLonger` now unused (kept for Inc 5's copy retire).

**Cold review (4 rounds, fresh agent each, scoped to the immutable commit) — all findings fixed + regression
-tested:** R1 — accepting "Use polished version" was reverted by Share (the finished branch never synced
`proseDraft` to the polished text → Share sent stale pre-polish as `correctedProse`); fixed in `runFinish`.
R2/R3 — the in-flight mutation lock was one-directional; unified into `busy` (disables editor/toggle/decline/
Finish/offer/Continue/drop) + `otherMutationInFlight` (gates the mic START; mic stays live only to STOP),
covering recording, typed append, decline, Finish, AND ✨Polish — the enumeration is now exhaustive
(drop-take is prose-safe). R4 — clean, ship.

**DEFERRED hardening (recorded, NOT done — out of this web slice's scope):** core `logPolish` writes
`stories.prose` with NO priorProse/staleness guard (unlike the append/finish paths). Adding one is a
`@chronicle/core` write-path SIGNATURE change (frozen-contract §4, Inc-2 territory) → an AFK stop-condition.
The client mutation lock closes the single-client UI-reachable clobber; the server guard only matters for
concurrent multi-session writes. Track as an Inc-2/hardening follow-up.

**Slice 11 (NEXT) — scoped (read-only investigation done):** KEEP (live `/s/[token]` consumers) `poll-status.ts`
(`pollUntilReady` → `ApprovePending`/`NarratorRecorder`), `answer-status.ts` (`mapStoryStateToStatus` →
`/api/capture/status/route.ts`), and `AnswerReviewPending.tsx` (still the composing take-0 screen). DELETE
(zero remaining consumers): the `{kind:"ready"}` `ThreadStep` variant, `getAnswerStatusAction` +
`AnswerStatusActionResult` + the now-orphaned `mapStoryStateToStatus` import in `actions.ts`, and the dead
`getAnswerStatusAction` mocks/assertions in `story-composer.test.tsx` + `answer-flow-optimistic-transition.test.tsx`.

## Build status (updated 2026-07-04, through Slice 9)
**Slice 9 `a5a2f28` (LANDED, cold-reviewed clean; full suite green: core 277, pipeline 74, capture 38,
db 67, apps/web 398, typecheck 0).** Routing relax. A live `draft`-state story is now resumable on both
resume pages, and the story `state` is threaded onto the client `DraftInfo` (`"draft" | "pending_approval"`)
for Slice 10 to key phases off. PLUMBING ONLY — a resumed `draft` still renders the existing review markup
(no phase collapse yet); no rendered-behavior change. Changes: `DraftInfo` gains `state`;
`tell/[storyId]/page.tsx` guard widened pending-only → `draft|pending_approval` (+ set `state`);
`answer/[askId]/page.tsx` resolves the ask's draft via `listOutstandingDrafts` (both states) instead of the
pending-only `listOutstandingAnswerDrafts` (+ set `state`, + guard text-answer null media → `mediaUrl:""`).
New `answer-resume-page.test.tsx`; extended `tell-resume-page.test.tsx`; existing review-phase fixtures gained
`state:"pending_approval"`. **AFK micro-decisions:** (1) `listOutstandingAnswerDrafts` is now unconsumed by app
code but RETAINED as a tested core-barrel API — removing an exported core fn is a contract change, out of scope;
the Questions-tab pending-only split stays via the web helper `questionsTabAnswerDrafts`. (2) Added the
text-answer-draft media guard because the relax newly exposes text-origin drafts (would otherwise render
`/api/media/null`). Cold review (fresh agent, scoped to the SHA) found NO material defect. **Slice 10 (phase
collapse — the LAST big one) is next; StoryComposer does NOT yet branch on `state`.** Run paused by the user
after Slice 9.

## Build status (updated 2026-07-04, through Slice 8)
**Slice 8 `e21e97b` (LANDED, riskiest slice, cold-reviewed; full suite green: core 277, pipeline 74, capture 38,
apps/web 393, typecheck 0).** Finish + Finish-check. `finishDraft` ADDED to the core barrel. New
`finishDraftAction(intent: probe|accept|decline)` in `answer/[askId]/actions.ts`: **probe** runs `polishProse`
speculatively on the CLIENT's posted `prose`; a real polish (`modelId!==""`) that MATERIALLY differs
(`normalizeWhitespace` collapse-runs+trim `!==`) → `{kind:"finish_offer", storyId, polished, polishModelId,
polishPromptText}` persisting NOTHING; else finishes as-is. **accept** re-uses the client-echoed polished text +
provenance → `logPolish` (1 `ai_polished` row) → `deriveMetadata` (1 LLM) → `finishDraft` — NO second `polishProse`
(**0 extra LLM calls**, asserted by mock call count). **decline** → `deriveMetadata`+`finishDraft` as-is. Owner +
`draft`-state guarded up front via `getStoryForViewer` (closes the accept-path IDOR/partial-write window). Two new
ThreadStep variants `finish_offer`/`finished`. **RESOLVED DECISION (c) folded in:** `shareAnswerAction`
`augmentProfileFromStory` source `approved.transcript`→`approved.prose` (+regression: new-model story, transcript
NULL/prose set → augments). Minimal client wiring in `StoryComposer.tsx`: Finish button (probe) + inline dismissible
offer card ([Use polished version]=accept; X "Keep mine as is"=finish-as-is/decline); on `finished`→`router.refresh()`.
**Cold review found 1 real bug → FIXED + regression test:** the offer card left the editor enabled and did not
invalidate a stale offer on edit, so accept could post STALE polished text and drop edits made between probe and
accept. Fix = `useEffect([proseDraft])` clearing `finishOffer` via functional updater `setFinishOffer(cur=>cur?null:cur)`
(no-op when null → never fires spuriously on mount or the append path's `history.replace` seeding). **KNOWN GAP for
Slice 10:** the Finish button lives in the review-phase markup (renders on a `pending_approval` story), so it is NOT
wired to a live `draft` end-to-end yet — expected per this slice's "server + minimal client, not integrated UI" scope;
Slice 10's phase collapse relocates Finish onto the always-mounted composing surface. Slice 9 (routing relax) is next.

## Build status (updated 2026-07-04, through Slice 7)
**Slice 7 `5eb4a8d` (LANDED, full suite green: core 277, pipeline 74, capture 38, apps/web 378, typecheck 0).**
`dropTakeAction` is now audio-only (RESOLVED DECISION d): dropping a follow-up take (position>0) deletes ONLY its
audio + returns a new `{kind:"take_dropped"}` step — no re-stitch, `stories.prose` untouched (narrator edits the
words out manually); dropping take-0 still discards the whole thread (`discarded`). **Newly-exposed FK bug fixed:**
Slice 6 made follow-up takes write `prose_revisions` rows FK'd to the recording, so `dropStoryRecording(position>0)`
would throw an `ON DELETE NO ACTION` violation (prose_revisions is append-only → the link can't be nulled). Fix:
`dropStoryRecording` now DELETEs the dropped take's `prose_revisions` rows FIRST inside the guarded txn (permitted
pre-consent; consistent with ADR-0002's "a discarded draft takes its prose_revisions with it"; take-0's + holistic
NULL-recording rows survive). Client `handleDropTake` handles `take_dropped` directly (refresh + `hub.answer.takeDropped`
notice + keep proseDraft), NOT via the poll/`ready` branch. `stitchAndRenderStory` REMOVED from `actions.ts` imports
(now only in `packages/pipeline`). Cold review found NO material defect. **Post-Slice-7: no answer action produces
`ready` anymore** — the `ready` variant + `getAnswerStatusAction` + poll infra STAY (link-session `/s/[token]` still
uses `pollUntilReady`); their removal is Slice 11 (re-verify consumers). Slice 8 (Finish, riskiest) is next.

## Build status (updated 2026-07-04, through Slice 6)
**Slice 6 `bbaf50b` + review follow-ups `583ba35` (LANDED, full suite green: core 276, pipeline 74, capture 38,
apps/web 377, typecheck 0).** Follow-up loop restaged onto per-take appends: `runFollowUpStep` is now
propose-only (`follow_up | null`, no stitch, no `ready`); BOTH take-0 paths in `recordAnswerAction` append
take-0 exactly once (flag-on then proposes) — `dispatchPipeline`/`ready` gone from that action;
`recordFollowUpTakeAction` appends with client-posted `prose` as `priorProse` (non-clobbering; missing→invalidInput),
append/transcribe failure → `saveFailed` (draft stays); `finishThreadAction` (decline, name KEPT — rename deferred
to Slice 10) records `skipped`, no stitch/transition, returns `appended` with current DB prose. Cold review found
NO live defect; the one core bug it surfaced is FIXED: `latestUnresolvedDecision` now excludes null-seed "none"
decisions (`selectedSeed IS NOT NULL`) so a lingering none-row can't collect a wrong answered/skipped outcome.
**Two Slice-10 forward risks recorded** (handle in Slice 10, do NOT ship live before): (i) `finishThreadAction`
returns server DB prose and the client `history.replace`s unconditionally — once the editor is mounted during the
follow-up screen, decline must echo the client `prose` OR the `appended` branch must skip replace when
`appendedSegment===""`; (ii) the client `appended` branch does not clear `followUp` state (stale follow-up prompt
after an append) — folds into the phase collapse. `stitchAndRenderStory` import + `ready`/poll infra STAY (used by
`dropTakeAction`, Slice 7 next).

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
