# ADR-0002 — Media immutability is consent-scoped; never-consented draft audio is deletable

Status: Accepted (2026-06-28) — amended by ADR-0008 (deletion is always available; audio is
un-detachable while its item lives but cascades on item deletion; "immutable forever" below is
superseded by that narrower rule, and it generalizes beyond Story to any voice-origin content).
Context: Phase 1 "complete the ask→answer→approve loop in the hub", with record-now-approve-later.

## Context

Increments 1/2/5 hardened a load-bearing invariant: audio Media is write-once and immutable,
enforced at two layers — a `MediaStorage` contract with **no `delete`** (all adapters refuse
overwrite; R2 uses `IfNoneMatch:"*"`) and a Postgres trigger that **raises on any `UPDATE`/`DELETE`
of `media`**. The original intent was trust: once a narrator's audio is relied upon, it can never be
silently swapped or vanish.

Record-now-approve-later makes the narrator persist a durable `draft` (audio + row) on every "stop",
and re-record over it or explicitly discard it. Under the original blanket rule those superseded /
discarded takes would accumulate forever, and the only invariant-respecting cleanup was archiving
(which never reclaims storage).

## Decision

**Immutability protects *consented* audio, not unapproved drafts.** The boundary moves from "all
media" to "any media tied to an approval".

- A media row may be `DELETE`d **only if** it is not referenced by any `consent_records` row **and**
  its owning Story has no `consent_records` row (the Story was never approved/shared). The recording
  clip *and* the spoken-approval clip of any approved/shared Story remain immutable and undetachable
  while the item lives; they are removed only when the item itself is deleted (ADR-0008) —
  they are the audit trail and improvement data.
- `UPDATE` on media stays forbidden in all cases. We never *mutate* audio; we only *delete*
  never-consented drafts.
- `MediaStorage` gains `delete(key)` (filesystem / R2 / in-memory). The audited core path
  `discardDraftStory` verifies draft + owner + zero consent rows, deletes the media row(s) inside
  the tx **first** (so a dangling reference never exists), then the caller best-effort deletes the
  blob (a leaked blob is harmless; a dangling row is not).
- Deletion is **event-driven only**: re-record supersession and explicit "discard". There is **no
  time-based sweep** — an untouched draft is intentional approve-later work, and a reaper would
  delete the answer the narrator means to come back to.

## Consequences

- The most security-sensitive layer (the immutability trigger) gains conditional logic; it must be
  tested that consented media still raises on delete, and that a draft with a consent row (should
  never happen, but) is refused.
- Storage is reclaimed for thrown-away takes without weakening any guarantee on shared content.
- Rejected: (a) archive-not-delete — invariant-clean but never reclaims R2, and the owner judged the
  audit guarantee to be about *approved* clips only; (b) time-based sweep — unsafe under
  approve-later.
