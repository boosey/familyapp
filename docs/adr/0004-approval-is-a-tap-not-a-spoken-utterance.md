# ADR-0004 — Approval is a tap (tier + confirm), not a spoken utterance

Status: Accepted (2026-06-28) — supersedes the voice-only approval gate of Increment 5 for the
in-hub flow.
Context: Phase 1 in-hub ask→answer→approve loop; target user is an elderly narrator.

## Context

Increment 5 built a *voice-only approval gate*: to share a story the narrator spoke a confirmation,
stored as an `approval_audio` Media row and referenced by the consent record
(`approvalAudioMediaId`) — "consent has a voice, not just a row." In the in-hub flow the narrator
has *just* recorded her answer; requiring a *second* recording to approve it is redundant and
confusing for the target user, and "approve straight away" was an explicit product ask.

## Decision

**Approval is a tap: pick the audience tier, confirm "Share".** No spoken-approval clip.

- `approveAndShareStory` makes `approvalAudio` **optional**; when absent the consent record is
  written with `approvalAudioMediaId = NULL` (the column is already nullable). The ledger row still
  records action, resulting state, tier, actor, and timestamp — consent is still audited, just
  without a voice artifact.
- The answer recording remains the canonical content; the tap is the consent act.
- The account-less `/s/[token]` surface may keep voice approval if desired, but the in-hub flow does
  not require it.

## Consequences

- The consent ledger loses the per-approval voice artifact for in-hub approvals — a real downgrade
  of the "consent has a voice" property the strategy/estate framing leans on. Accepted as a
  friction trade; revisitable (the column stays, so voice can be re-enabled without migration).
- The in-hub approval UI is a tier picker + button — no `MediaRecorder` on the approval step.
- Rejected: (a) keep voice approval (humane + strong audit, but redundant second recording for the
  target user); (b) reference the *answer* audio as the consent artifact (conflates content with the
  consent act — wrong).
