# ADR-0016 — Kinship is a Steward-governed, per-family tree of generative edges

Status: Accepted (2026-07-11)

> **Implementation status (2026-07-12, `kin-a-release` — pending release):** the edge model,
> provenance, governance, subject-hide veto, and story-subject tagging are implemented (#30–#35;
> migrations 0008–0010) and the visual tree renderer seam is now **partially filled** — the pure
> layout engine (`computeTreeLayout`) and a bounded root-anchored core read (`resolveKinshipTree`)
> are implemented and unit-tested, and create-time death fields landed (migration 0011). The rendered
> `/hub/tree` route (a `TreeCanvas` consuming the layout engine) is **not yet wired** as of this
> branch. GEDCOM/API import and reconciliation remain deferred seams. See
> `docs/99-pruned/superpowers/plans/2026-07-12-kinship-release-runbook.md`.

## Context

Family Chronicle models identity (`persons`), participation (`memberships` — Person↔Family), and
consent, but has **no Person↔Person kinship**: nothing records that Eleanor is Marcus's mother. The
strategy doc deliberately deferred "the deepest multi-lineage genealogy / tree skeleton" to a later
phase (`Identity-Data-Model.md:117`). This ADR defines that skeleton and its governance, driven by two
requirements: (1) not every relative is (or ever will be) a member or account holder, and (2) we want
to eventually import GEDCOM files and integrate genealogy APIs (FamilySearch, Ancestry).

The hard part is not the graph — it is authority and consent. A kinship edge is a claim about two
people, at least one of whom is not the asserter, possibly a *living non-member*, in an app whose whole
posture is consent-first. Membership already means something specific (which family contexts a Person
participates in); kinship must not be conflated with it, and must never grant content access.

## Decision

**Node = Person, always.** Every tree node is a `persons` row — no shadow-person table. A new
immutable **`origin`** enum (`self | invitee | mention`) records *why the row was created*; `mention`
means "named as kin, may never be contacted, may be deceased." Origin never flips (a `mention` later
invited keeps `origin = mention`); current state stays in `accountId` / `memberships` / `lifeStatus`.
The housekeeping reaper keys off `origin = invitee AND never accepted` — **never** `mention`.

**Two generative primitives.** Store only **`parent-of`** (directed, with a `nature` attribute:
`biological | adoptive | step | foster | unknown`) and **`partnered-with`** (undirected). Sibling,
grandparent, cousin, in-law, half/step are **derived** by walking the graph — never stored — so a
derived fact can never contradict a stored one. A GEDCOM `FAM` unit is **shredded** into these edges;
we never store a union node and never call it "family" (that word is the chronicle container).

**Unidentified bridge nodes.** Because only *generative* edges are stored, connecting non-adjacent kin
(granddaughter → grandmother) requires an intermediate node — but it may be deliberately anonymous. A
`persons` row therefore carries an explicit **`identified` boolean** (default true) and a **nullable
`displayName`**; a **placeholder** (`identified = false`, `origin = mention`) exists only to bridge an
unnamed generation, is rendered from the relation ("your father"), is **never reaped** and **never
invitable until identified** (filling the fields flips `identified`, `origin` unchanged). The UI may
create the bridge implicitly (one-tap "add grandmother"); the data always holds the explicit node.
`identified` is chosen over inferring anonymity from a null name because *deliberately unknown* and
*not-yet-typed* are different intents and drive different UI/reconciliation behavior.

**Governance is Steward-centric and per-family.** An edge is **surfaced into a Family** like a Story
(ADR-0010): visible to that family's members, governed by that family's **Steward**. The same
person-pair may be independently asserted in another family with its own Steward — never
auto-propagated. **First-asserter-wins**: the first assertion shows to the whole family as provisional
truth, no endpoint confirmation required. Governance is by **exception** — the Steward may **affirm,
deny, or correct**; any member may later **challenge** and the Steward **decides**. Every transition
is **append-only** (supersede, never edit), matching the Consent ledger and Follow-up decision record.

> **Amendment (2026-07-20, issue #256):** mistakes happen — the Steward should not be the only person
> who can undo one. The **original asserter of an edge may also `deny` (retract) that SAME edge
> themselves**, an append-only supersede identical in shape to the Steward's deny. This widens ONLY
> `deny`: `affirm`/`correct` remain **Steward-only** — endorsing or re-typing someone else's claim is a
> different trust question than undoing your own. A non-steward, non-asserter member still has no
> governance authority over an edge. The Family tree's Remove affordance is shown to a viewer who is
> the Steward **or** the edge's original asserter (`viewerCanRemove`); Endorse/Correct stay
> Steward-gated (`viewerIsSteward`).

**The subject keeps a veto.** The Person an edge is *about*, if a real account (`self`), has a
**hide** button that suppresses the edge family-wide and **overrides even a Steward affirmation** —
being depicted at all is the subject's own consent, not a dispute the Steward adjudicates. A `mention`
subject has no account, so mentions stay purely Steward-governed.

**Import is deferred, additive, Steward-only, idempotent.** v1 ships **manual edges + story-subject
tagging** only; GEDCOM/API import, reconciliation, and the visual tree renderer are seams filled later.
When built: import is **Steward-only**, **always additive** (every imported individual is a new
`mention`, never auto-merged), runs as a **background job** with per-item progress, persists an
**`external_ref`** (`source`, `sourceId`, `importBatchId`) so re-sync matches on `(source, sourceId)`
— foreign ids, never names, drive idempotency — and offers a **deceased-only fast path**. Merging an
imported `mention` onto a known Person is a **separate, human-confirmed reconciliation** step, never
part of import (same offer-never-silent discipline as dedup-on-invite).

**Kinship never drives authorization.** It is a distinct data category, not Story/Media content, so it
does not widen the single front door; content visibility is still membership + consent alone.

## Considered options

**Per-asserter private weave with endpoint confirmation** (initial recommendation, rejected): edges
scoped by `assertedBy`, no global tree, the endpoint confirms/rejects claims about them. Maximally
consent-first, but produced N disconnected private trees, required a bespoke per-asserter read surface,
and fought the existing Steward moderation model. Rejected in favor of a shared, Steward-governed tree
that reuses authority the domain already has — with the subject-hide veto re-added to recover the
consent guarantee the endpoint-confirmation gave.

**Global authoritative tree** (rejected): one tree across all families. No answer to "which Steward
governs a cross-family edge," and lets one family's assertions leak into another's view.

**Enumerated relationship types** (rejected): store `sibling-of`, `grandmother-of` explicitly. Redundant
and self-contradicting; the generative primitives derive them without that risk.

**Import as auto-merge** (rejected): match imported people onto existing Persons automatically. Risks
silently fusing a living member's account into a stranger's imported data — exactly the merge that must
be human-confirmed.

## Consequences

- **The tree is a per-family projection, not a stored global object.** Rendering "the family tree" is a
  query over that family's edges; cross-family reconciliation is a future concern.
- **Steward workload grows.** Stewards now adjudicate kinship disputes on top of content moderation and
  join approval. Acceptable — it is the same governance authority, extended.
- **A subject's hide can override a Steward-affirmed edge.** This is intentional; it is the one place a
  member outranks the Steward, and it is what keeps the model consent-first.
- **`mention` Persons accumulate** as accountless rows whose only purpose is being named in a tree. The
  reaper must treat them as permanent; only `invitee` origins are reapable.
- **Import lands as a disconnected island** of `mention`s until reconciliation runs — the deliberate
  price of never silently merging a real member into imported data.
- **Kinship needs its own authorization path** (own function + architecture-test allowlist entry),
  parallel to the story front door, scoped by family membership with the subject-hide overlay.
