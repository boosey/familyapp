# Narrator AI Follow-ups — deferred items & follow-up tickets

The feature (`docs/superpowers/plans/2026-07-02-narrator-follow-ups.md`) landed on
`feat/narrator-follow-ups`, gated behind the off-by-default `FOLLOW_UPS_ENABLED` flag. It shipped
SHIP-READY per the final integration review. The items below were surfaced during the build/reviews
and deliberately deferred — they are NOT merge blockers.

## Needs a product decision
1. **Post-share audience audio is take-0 only.** `decideMediaRead` authorizes story audio by joining
   `stories.recordingMediaId` (= take 0). Owner review plays every take (per-take relisten via
   `story_recordings`), and the shared **prose** stitches all takes — so no content is lost. But a
   family viewer of a *shared* multi-take story can only relisten take 0's audio, not the follow-up
   takes'. This matches ADR-0012's "`recordingMediaId` stays the take-0 pointer" literally, but ADR-0012
   never specified audience playback of the full thread. **Decide:** should a shared audience be able to
   relisten the whole ordered take set? If yes, the audience media-read path needs to authorize
   `story_recordings[*].mediaId` for an approved+shared story (a new audited read), not just take 0.

## Needs a cleanup sweep (flag-on only)
2. **Abandon-mid-thread orphan.** A follow-up thread abandoned before completion stays `state="draft"`.
   `listOutstandingAnswerDrafts` gates on `pending_approval`, so it correctly does **not** resurface as a
   broken empty-prose review — but that draft row + its already-uploaded take blobs are never reclaimed
   and are invisible to the narrator. Only reachable with the flag ON. Add an event-driven or swept
   cleanup for stale flag-on draft threads (aligns with the existing "discard/re-record delete audio"
   event-driven cleanup discipline; no time-based sweep exists today).

## Accepted (already code-commented — no action needed)
- A failed evaluation turn (evaluator/phraser throw, or budget timeout) writes **no** decision row for
  that turn — the deliberate "rather no row than a misleading null-`phrasedLine` row" tradeoff. The
  narrator still finishes (degrade → stitch). Commented in `actions.ts` `runFollowUpStep`.
- A timed-out evaluator promise isn't cancellable (JS), so it may append a dangling *unresolved*
  `selected` decision after the story is finalized. Harmless: the approve/share/finalize paths never
  read unresolved decisions. Commented at `withTimeout`.
- The old dead `follow_up` `PromptIntent` in `behavior.ts` `pickNextIntent` is intentionally left intact
  and unwired (no production surface mounts the turn loop). The feature uses the new `decideFollowUp`
  path exclusively.

## Housekeeping
- **ADR-0012 / ADR-0013 are still `Status: Proposed`.** The handoff suggested flipping them to
  `Accepted` once the feature lands, *if the user agrees*. Left as Proposed pending that agreement.
- **Shared branch.** `feat/narrator-follow-ups` also carries a concurrent, separate "onboarding inline
  name/DOB capture" feature (commit `2bbeda7` + uncommitted `packages/core/{onboarding,accounts,names}`
  and `apps/web/app/welcome/*` work) developed by another session in the same tree. The two features are
  disjoint by file. Before merging, decide whether to split them into separate branches/PRs.
