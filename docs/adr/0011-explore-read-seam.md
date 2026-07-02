# ADR-0011 — Mode 4 Explore reads through a SQL visibility predicate that provably mirrors the single-item oracle

Status: Accepted (2026-07-01)

## Context

The single front door (`decideStoryRead` in `@chronicle/core`) evaluates one story at a time, and the
list helper (`listStoriesForViewer`) materializes **every** story row, then filters in a JS loop with
1–2 extra queries per story (consent ledger, both parties' active families). That is fine for the hub
(one narrator's dozen stories). Mode 4 (the Explorer/Audience payoff surface — persona Sofia) is a
rich, mobile-first browse over a chronicle meant to accumulate for a century: feed, timeline, search,
paginated and sorted. The scan-and-filter shape cannot paginate (it loads all rows before filtering),
cannot sort in the DB, and does N+1 work per story.

The hard constraint: the surface must **not** become a second authorization implementation. Every
duplicate of the tier/consent/membership rules is how a bypass is born.

## Decision

Keep **one authorization decision**, expressed two ways that are provably equivalent:

1. `decideStoryRead` remains the **single-item oracle** — the readable, allowlisted definition of the
   rule, guarded by the architecture test and used by all point reads.
2. Add **one audited SQL visibility predicate** in core that emits the *same* allow/deny logic as a
   composable `WHERE` clause: `owner = viewer OR (state ∈ {approved, shared} AND latest-consent =
   approved_for_sharing AND (public OR co-active-membership in a targeted family))`. Explore's feed,
   timeline, and search compose pagination / sort / era / family-scope filters **on top of** this
   predicate.

The predicate is **property-tested to agree with the oracle row-for-row** over generated fixtures —
that test is the guard that keeps the two implementations from drifting. The predicate lives in the
core allowlist alongside `authorization.ts`; it is not a new bypass, it is the front door in
set-at-a-time form.

Rejected alternatives:
- **Reuse the scan-and-filter as-is** — cannot scale to the payoff surface; deferred only for the hub.
- **Materialized "visible-to-viewer" projection** refreshed on approve/revoke/membership-change —
  faster reads, but adds a consistency surface where a stale row after a revocation is a **consent
  leak** (the worst failure mode here). Rejected; the SQL predicate reads live from the ledger, so a
  revocation is honored the instant it lands.

## Consequences

- **Explore is family-scoped and narrowing-only** (ADR-0010): the family filter and per-narrator scope
  are extra `WHERE` clauses that can only *remove* rows the predicate already allowed — never widen —
  so scoping cannot become a bypass.
- **New CI guard:** the predicate↔oracle property test. If someone changes one rule and not the other,
  CI fails.
- **Every explorer is an authenticated member** — v1 ships no anonymous/`public` read surface and no
  external sharing, so the predicate's `public` arm is latent (kept faithful, unused by a surface).
- **Deferred out of v1** (see `docs/OPEN-QUESTIONS.md`): map, family tree, the "Ask the archive" Q&A
  synthesis engine, clip trimming/editor, external sharing. v1 = feed + timeline + Chronicle search,
  all pure projections over this predicate.
