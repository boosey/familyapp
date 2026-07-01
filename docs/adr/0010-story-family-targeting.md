# ADR-0010 — Story→family targeting: visibility is scoped to the families a story is surfaced into

Status: Accepted (2026-07-01)

## Context

The Phase-0 model derived a story's family visibility from the **owner's** memberships alone:
`family`-tier meant "any Person co-membered with the owner in *any* family." The schema encoded this
as an invariant — verbatim: *"Sharing is a visibility computation against memberships, so there is no
story↔family table."*

The Mode 4 Explore grill surfaced a scenario that model cannot express. A Person married into a second
family belongs to two families at once (e.g. Boudreaux **and** Carney). Their wedding story belongs in
**both**; a Boudreaux-only childhood story belongs in **one**. Under owner-derived visibility, *every*
`family`-tier story the person owns is visible to *both* families indiscriminately — there is no way to
say "this one is Boudreaux-only," and no data on which to build the family filter Explore requires
("filter to just Carney" needs to know which family a story belongs to). Marriage joining two families
is the common case, not an edge case, so the model must represent it.

## Decision

Add an explicit **story→family targeting** relationship: `story_families(story_id, family_id)`,
many-to-many. A story is **targeted** to one or more of its owner's families; that set — not the
owner's full membership — governs `family`/`branch`-tier visibility.

This is **not** the "copy table" the old invariant prohibited. The story remains a **single row, owned
by one Person, never duplicated per family** (Person owns everything expressive; Family owns nothing —
both intact). Targeting is a *visibility-scoping set*, not a per-family copy. Only the **derivation** of
family-tier visibility changes:

- **Old:** family-tier visible to co-members in *any* family the **owner** belongs to.
- **New:** family-tier visible to a viewer co-membered with the owner in a family the **story is
  targeted to**, *and* that the owner still actively belongs to.

Enforcement (`decideStoryRead`, the single front door) intersects
`story's target families ∩ owner's active families ∩ viewer's active families`. Still **narrowing
only** — targeting can only *remove* visibility the old rule granted, never add — so it cannot become a
bypass. `private` = owner only (targeting irrelevant); `public` = everyone (targeting is used only to
decide which family chronicle it appears in).

Targeting is **orthogonal to `branch`**: targeting picks *which families*; `branch` is still a
sub-group *within* a targeted family (enforced as family in Phase 0).

## Consequences

- **Schema (rides the reseed workflow):** add `story_families` (story_id, family_id). Deleting a
  membership or leaving a family must re-evaluate visibility (handled live by the owner-active-family
  intersection, so no denormalized cleanup needed).
- **Core authorization change:** `decideStoryRead`'s family/branch branch changes from "owner ∩ viewer"
  to the three-way intersection above. `authorization.ts` stays the sole allowlisted enforcement site.
- **Approval gains a targeting choice, defaulted to the originating family context.** The capture
  already knows its family (`link_sessions.familyId` is `NOT NULL`; an `Ask` carries `familyId`), so a
  story defaults to the family it was captured in — a single-family narrator never sees a prompt. A
  multi-family member multi-selects to *widen* (the wedding → both). Only when there is no originating
  context *and* the owner is in several families is an explicit pick forced. The default is
  deliberately **never "all"** — that would reintroduce the over-share this ADR exists to prevent.
  (Future: an LLM suggests the target families from the item's content — see `docs/OPEN-QUESTIONS.md`.)
- **Explore is family-scoped** on top of this (ADR-0011): a family's chronicle = visible stories
  targeted to that family.
- **Asymmetry with Ask, on purpose:** an `Ask` carries a single `familyId` (one raised question in one
  context); a Story carries a *set* of target families (one telling, surfaced into several). Not
  unified.
