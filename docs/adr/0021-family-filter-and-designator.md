# ADR-0021 — One family control, two behaviours: a browse Family filter vs an action Family designator

Status: Accepted (2026-07-15)

Replaces the single-select `?scope=` hub selector (the top-right `[ All ▾ ]` pill, `HubScopeSelector`)
with a shared, per-surface **Family filter** on the browse surfaces and a separate **Family designator**
on the action flows. The two share one visual chip widget but not their state or semantics.

## Context

The hub shipped a single `?scope=` URL param (`all` | one familyId), authored server-side and threaded
through **every** hub tab. That one control was quietly doing two unrelated jobs:

1. **Filter-by** — "show me the photos / stories / tree *for* these families" (browse surfaces).
2. **Operate-in** — "the family I'm acting *on*" — invite *to* a family, ask *within* a family, view a
   family's join requests (action tabs).

Conflating them under one single-select control forced awkward compromises: the album withheld its
uploader entirely when scope was `all` with multiple families (the "add" target was ambiguous), the tree
ignored the selector, and there was no way to browse more than one family at once.

The desired end state: multi-select browsing on the album and stories, single-select on the tree (for
now), and action flows that still resolve exactly one family — without the browse selection and the
action target clobbering each other.

## Decision

**A single presentational chip widget (`FamilyChips`) renders in one of two modes; the mode — not the
widget — carries the meaning.**

- **Family filter (browse: album, story browse, tree).** Bound to a shared URL param, renamed
  `?scope=` → **`?families=`** (a comma list of family ids; **absent = all**, an explicit `none` sentinel
  = the empty set). The filter only **narrows what is displayed** — it never grants access nor targets a
  write. **Multi-select** on the album and stories; **single-select** on the tree. Turning off every chip
  is legal and yields an explicit **empty state**, not a silent "show all" (chip on = include; none
  included = nothing shown). The chip bar renders **only when the viewer has ≥2 families** — one family
  has nothing to filter.

- **Family designator (actions: invite, ask, requests, add photos).** The family the action **operates
  on** — a single family for invite/ask/requests, one-or-more for adding photos. Held as the action
  flow's **own state**, **seeded** from the current filter but **never written back**: changing the
  designator picks who you act on and does **not** change what the viewer is browsing. Adding/importing
  photos always shows its uploader (decoupled from the filter) and defaults its target to the **sole**
  family when unambiguous, else forces a **deliberate pick** — a photo never silently fans out to every
  family.

- **Tree is single-select today, chosen for forward-compatibility with multi-family trees.** The tree is
  a browse *filter* (it writes `?families=`) but constrained to one family: tapping a tree chip collapses
  the shared set to that family, and arriving with several selected shows the first. When multi-family
  tree rendering is designed later, this becomes purely additive — the tree's chips flip from *replace*
  to *additive* and it renders N trees; the `?families=` contract, the widget, and action-tab derivation
  are unchanged.

- **The discarded pill's other job moves out.** "Create a family" and "Find a family to join" lived only
  on the old pill; they relocate to the **account menu** (and only there) — a home that works for
  no-family and single-family viewers, who never see a chip bar.

## Consequences

- **The biggest cost is the action-tab refactor, not the widget.** Ask / Asks / Invite / Requests today
  read a *single* family from `?scope=` **server-side**. As designators they must instead receive *all*
  of the viewer's families and resolve the operating family **on the client** (seeded from `?families=`),
  each becoming a small client-seeded flow. This is more work than the chip bar itself.
- **`?scope=` is retired.** Every producer/consumer of the old param moves to `?families=`; the
  server-side validation (a client-crafted scope is never trusted; unknown ids fall back to all) carries
  over to the multi-value form.
- **The album "add" ambiguity is resolved by design** rather than by hiding the uploader: the uploader is
  always present and the target is an explicit multi-select designator.
- A future reader will ask "why does a browse selection write to the URL but an action selection doesn't,
  why is the tree single-select, and why do the chips disappear for a one-family viewer?" — this ADR is
  the answer.

## Alternatives considered

- **Literal write-back (one param is the single source everywhere).** The designator *is* `?families=`;
  picking a family to invite to collapses the browse filter. Rejected: choosing who to act on would
  silently change what the viewer sees afterward ("I invited someone and my photos disappeared") — a nasty
  surprise for the elder audience, and the exact failure a prototype made visible.
- **Per-surface / separate params (e.g. `?tree_family=` distinct from the browse filter).** Rejected: it
  introduces a second family-selection concept to keep in sync and contradicts the "one shared filter"
  intent; the single-set model with a single-select *view* on the tree is the smaller surface and is
  forward-compatible with multi-tree.
- **"0 selected = all" fallback.** Rejected: a filter that silently overrides an explicit empty selection
  teaches the user not to trust it; the literal empty state is honest.
- **Per-viewer short-name override built now** (to disambiguate two similarly-named families). Deferred,
  not part of this ADR — it needs an account-level person×family store and a "manage my families"
  surface; the steward-set **Short name (Family)** ships first and tolerates cross-family collisions until
  then.
