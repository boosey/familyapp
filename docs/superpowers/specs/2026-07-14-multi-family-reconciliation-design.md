# Multi-Family Membership & Cross-Family Person Reconciliation — Design

Date: 2026-07-14
Status: Design approved — ready for implementation plan
Decision record: `docs/adr/0019-cross-family-person-identity-is-a-soft-link-cluster.md`
Builds on: ADR-0016 (kinship), family scope selector, ADR-0010 (per-family surfacing)

## Problem

A person can belong to multiple families, and a hub surface can show a combined view across families or
be filtered to one/a subset. But the same real human is often represented as **two separate `persons`
rows** — because two families independently typed an accountless `mention` of them. We need to:

1. Recognize duplicates as the same real person **without** collapsing per-family autonomy or leaking
   cross-family participation.
2. Let combined views (tree, feed, stories-about, avatars) render "one person" from the duplicates.
3. Surface likely duplicates when adding a relative, and when a depicted person joins a family.

## Key framing (see ADR-0019 for the full decision)

- **Account-holders are already multi-family** with one row + many `memberships`. No clones, no new
  entity for them. Reconciliation is **only** about accountless `mention`s and the moment one becomes an
  account.
- **Belonging = an accepted `membership`. Depiction ≠ belonging. No one is auto-joined.** Reconciliation
  unifies identity, never membership; identity linkage never widens the content front door.
- **Soft link, not physical merge.** Sameness is an append-only ledger row; "one person" is a
  **per-viewer, render-time cluster**.
- **Disclosure rule:** a **dual-member** (member of both families) may confirm sameness; the link is
  consumed only in combined views across families the viewer belongs to.

## Data model

### New guarded table: `person_identity_links`

Append-only (supersede, never edit/delete), enforced by a Postgres trigger + a repository that exposes
only append + read — the same two-layer pattern as `consent_records` and `kinship_assertions`. Reachable
only via a new `@chronicle/db/identity` subpath; the architecture test gains an allowlist entry for the
new core repository file.

Columns (indicative — finalize in schema.ts):
- `id` (uuid, pk)
- `personLowId`, `personHighId` (uuid → persons) — the pair, stored **id-ordered** (low < high) so a
  pair has one canonical orientation and duplicate assertions are detectable.
- `relation` enum: `same_as` (v1; leaves room for future `not_same_as` negative assertions).
- `state` enum: `asserted | challenged | superseded` (append-only transitions).
- `assertedByPersonId` (uuid → persons) — must be a dual-member of both families at assert time.
- `assertedInFamilyContext` — the family pair this assertion bridges (`familyAId`, `familyBId`) so
  per-family "deny" can be scoped and audited.
- `supersedesId` (nullable uuid → self) — reversal chain, like the consent ledger.
- `createdAt`.

**Per-family honor/deny** rides the existing kinship governance surface where possible: a Steward "deny
for my family" writes a superseding/annotating row that removes the link from *that* family's combined
view without destroying it. **Subject veto** writes a superseding row that removes it everywhere.

No change to `persons`, `memberships`, `kinship_assertions`, or the consent ledger. One additive
migration (`NNNN_person_identity_links` + hand-carried append-only trigger, per the migration runbook).

### Cluster = union-find closure

"One real person" is never stored. A pure resolver walks active `same_as` links to produce clusters:
- **Scoped to a viewer's families** — only links whose both endpoints are visible to the viewer (i.e.
  the viewer is a dual-member spanning them) participate; single-family viewers see singleton clusters.
- **Poison-merge defensive** — the resolver is a pure function over a link set; a challenge/veto removes
  one edge and the closure recomputes, so cutting one link cannot silently keep two real clusters fused.
- **Canonical representative** — for a combined avatar/name, pick a deterministic representative
  (e.g. the `self`/account row if any, else lowest id) so combined UI is stable.

## Core surface (`@chronicle/core`, parallel to kinship — never the story front door)

A new authorized module (allowlisted in `architecture.test.ts`):
- `assertSameAs({ actorPersonId, personA, personB })` — authorizes actor is a **dual-member** of the two
  persons' families; appends `same_as`.
- `challengeSameAs(...)` / `denyForFamily(...)` / `subjectVeto(...)` — append superseding rows with the
  right authority check (dual-member / Steward-of-family / subject-with-account).
- `resolveIdentityCluster({ viewerPersonId, personIds })` — the render-time resolver; returns clusters
  scoped to the viewer's families with a canonical representative each.
- `listPendingMatches(...)` — deferred ("not sure") suggestions a dual-member can later resolve.

**Invariant tests:** identity linkage grants no content read; `resolveIdentityCluster` for a
single-family viewer returns singletons (no cross-family leak); a veto overrides a Steward affirm; a
challenge cuts exactly one edge.

## Matching (scope (b), precision-tuned)

A pure `scoreMatch(candidate, target)` over the **union of the adder's families**' persons:
- Signals: name similarity + birth-year proximity + count of overlapping *derived* kin.
- Emits a hint only above a confidence threshold, tuned to **fewer, high-confidence** hits (name-only
  collisions with no corroboration do not fire).
- Read-only; never searches outside the adder's families (no stranger disclosure).

Runs in two places: (1) **add-relative** as the user types; (2) **join** a family, against that family's
existing `mention`s.

## UX

### Add-relative match hint (validated mockup)
Inline amber hint under the form when a candidate scores above threshold: avatar, name, "already in your
**Carney** family · born 1938 · sister of Ada", and three actions:
- **Yes — same person, link them** → add the new edge AND append `same_as`.
- **No — add as new** → two unlinked rows; suppress future hints for this pair.
- **Not sure — add new for now** → new row + a pending suggestion a dual-member resolves later.

### Join-time reconciliation (proactive + gentle)
On accepting a membership, run the matcher against the family's `mention`s and *invite* the joiner to
claim a depiction. Confirm → `same_as`; the subject-veto now attaches to that depiction. Decline → rows
stay separate. Never blocks the join; framed as an invitation, not an alarm.

### Tree rendering — Option C default, B opt-in
- **C (default):** render one family at a time (scope selector), badge nodes that are `same_as`-linked
  into the viewer's *other* families with "also in Carney →"; tap to hop to that family's tree. The
  layout engine (`computeTreeLayout`) stays a single-projection function; the badge is an overlay from
  `resolveIdentityCluster`.
- **B (opt-in, later):** a "merge view" toggle that fuses the viewer's families' edges into one graph
  with clusters collapsed. Deferred — this is where layout-merge complexity and density live.

### Combined-feed / stories-about dedupe (IN v1)
Combined ("All"/multi-family scope) surfaces resolve identity clusters so a duplicated person renders
once:
- **Stories-about-Eleanor** unify across the viewer's families (walk the cluster, union the
  authorized story-subject rows, dedupe) — still narrowing via the authorized predicate, never granting.
- **Avatars / name chips / people lists** in combined scope render the cluster's canonical representative
  instead of two near-identical entries.
- Single-family scope is unaffected (singleton clusters).

## Scope

**In v1:**
- `person_identity_links` guarded table + append-only trigger + migration + `@chronicle/db/identity`.
- Core authorization surface (`assertSameAs` / challenge / denyForFamily / subjectVeto /
  `resolveIdentityCluster` / `listPendingMatches`) + architecture-test allowlist entry.
- `scoreMatch` matcher (adder's-families scope, precision-tuned).
- Add-relative hint UI + join-time proactive reconciliation offer.
- Tree "also in …" bridge badges (Option C).
- **Combined-feed / stories-about / avatar dedupe** via cluster resolution.

**Deferred (future, additive on this core):**
- Option B merged super-tree toggle.
- ADR-0016 Option C **deceased-only physical merge**.
- GEDCOM / genealogy-API import reconciliation (already deferred in ADR-0016) — reuses this ledger.
- `not_same_as` negative assertions to permanently silence a rejected pair across dual-members.

## Testing (PGlite + pure-function units)
- Append-only trigger rejects UPDATE/DELETE on `person_identity_links`.
- `assertSameAs` rejects a non-dual-member; accepts a dual-member.
- Cluster resolver: single-family viewer → singletons; dual-member → collapsed; transitive closure;
  challenge cuts one edge without shattering; poison-merge guard.
- Subject veto overrides Steward affirm; Steward deny scoped to one family only.
- Identity link grants **no** content read (front-door invariant regression).
- Matcher precision: name-only collision does not fire; name + year + shared kin does.
- Join-time offer fires against existing `mention`s; declining leaves rows separate.
- Combined-scope stories-about dedupe unifies across families without widening authorization.

## Open questions for the plan
- Exact scoring weights / threshold value (tune against seed data; start conservative).
- Whether "deny for my family" reuses the kinship governance table or needs its own annotation row.
- Representative-selection tie-breaks when a cluster has multiple `self` rows (should be rare/impossible;
  assert and log).
