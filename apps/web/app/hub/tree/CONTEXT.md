# Context — /hub/tree (ego-centric family tree)

Glossary for the visual family-tree renderer. Terms only — no implementation. See the build
contract in `docs/superpowers/specs/2026-07-13-tree-ego-nav-redesign.md` and ADR-0016/0017.

## Anchor
The fixed person the tree is centered on (spec calls it the "focus person"). Seeds the initial
framing and initial expansion only; not selectable, not re-rootable, carries no visual marker.
"Anchor" and "focus" are the same thing; prefer **anchor** in interaction rules.

## Caret
A per-direction expand/collapse control in a card's outer gutter: **parents ↑, siblings ↔,
children ↓**. Points toward the card when collapsed, away when expanded. A caret exists only where
there is kin to reveal or a drawn branch to collapse.

## "+" (add affordance)
Replaces a caret in a direction that has **no kin at all**. Starts add-a-relative in that
direction. A caret and a "+" are mutually exclusive for a given (person, direction).

## Relationship / bus
A drawn kin connection is ALWAYS a **descent bus** (parent→children), drawn in up to three parts:
a **U** joining two parents' bottoms (a lone parent has no U), a **vertical riser** to the child level,
and an **inverted-U** bar with a drop to each child (a single child has no inverted-U — the riser drops
straight in). The U is part of the descent bus, drawn *below* the parents — it is NOT a row-level line
between the two spouse cards. Two cards that share a row — **partners or siblings — are never joined by
a direct horizontal line at their own row height.** A partnership reads from **proximity**: partners sit
~half the normal same-row gap apart (`PARTNER_GAP`); their connection is the descent bus below them.
Siblings connect only *up* through their shared parents' descent bus. There is no partner-link glyph.

## Caret ownership (the core invariant)
Every revealed relationship is controlled by **exactly one caret**, owned by whichever endpoint is
**nearer to the anchor** along the path traveled to reach it. The farther endpoint never shows a
caret pointing back toward the anchor. This is a spanning tree rooted at the anchor: each drawn
person (except the anchor) has one *discovery edge* to the node that revealed it, and that edge's
caret lives on the **discoverer (nearer) side**. "Up from the anchor / down from the anchor" is just
this rule applied to the direct lineage.

Consequence: a relationship whose **both** endpoints are already drawn — but which was *not* the
discovery edge (e.g. a laterally-revealed sibling and the shared parent) — carries **no caret at
all**. Carets exist to reveal hidden kin or collapse a branch, not to decorate realized links.

## Out of scope (this pass)
Half-siblings (single-shared-parent), multiple partners / children-across-unions, the same person on
two lineage paths (cousin marriage / pedigree-collapse artwork), and step/adoptive distinctions all
stay **deferred**. The caret model assumes: full siblings (both parents shared), one partner, one
children-bus per couple, dedupe-by-personId first-caret-wins, and edge-type-uniform kinship.

## Collapse / re-expand
Collapsing a caret **hides** the whole branch beyond it but **remembers** the nested expansion;
re-expanding restores the prior deep state exactly (grandchildren, in-law branches and all). This is
suppression, not forgetting — collapse marks the direction collapsed without purging descendants'
expansion flags. "Instantly re-expandable" (spec §7) means no network round-trip *and* no loss of the
sub-shape.

## Direct lineage vs collateral
**Direct lineage** = the anchor's ancestors straight up and descendants straight down. Rules "no
children-caret above / no parent-caret below" apply to the **direct lineage only**, because the
lineage neighbor is already drawn and nearer. **Collateral** kin (aunts/uncles, the anchor's
siblings, cousins, nieces/nephews) sit in an ancestor's or descendant's generation but are reached
sideways; a collateral relative whose own descendants are still hidden keeps a **children-caret**
(cousins, nieces/nephews) or a "+" if childless. The model recurses: a revealed cousin is nearer to
the anchor than her kids, so she in turn owns a down children-caret.

## In-laws (partners) — no carve-out
Rule 9 as originally written ("anchor/ancestor partners") is **superseded**: *every* drawn partner
is a full tree member with its own parent/sibling carets toward its hidden kin, exactly like a blood
relative. There is no special-casing of in-laws — the nearer-owns invariant alone governs. A child's
spouse can reveal the co-in-laws; a cousin's spouse can reveal their family. (More navigable and more
carets — the accepted trade.)

## Sibling set / child set
Co-siblings are revealed as a **set** by a single caret owned by one member — the anchor itself
(its sibling-caret) or, for a revealed child/cousin group, the shared parent's children-caret. Other
members of the set never own a sibling-caret; the set has exactly one owning control.

**Sibling-affordance ownership:** a person shows a sibling caret **or** "+" only if they *own* their
sibling set — reached as an individual (the anchor, a partner, or a lineage parent reached via a
parent-caret). A person reached as a **set-member** (a revealed child, a fanned sibling, a cousin, a
niece) shows **no** sibling affordance at all, even an only child — "add a sibling" there means "add a
child to the owning parent," which is the parent's control (or the kebab). This reconciles rules 6 & 7.

## Rule 8 coupling (sibling ⇄ parent), generalized
Because siblings hang off the **shared parent-couple's descent bus** (Model A), expanding any
sibling-set owner's sibling-caret **auto-expands that owner's parents** (the bus). Closing the parents
closes the siblings (bus gone); closing the siblings leaves the parents (bus stands alone). Holds for
every owner — the anchor, a lineage parent revealing aunts/uncles (auto-expands grandparents), an
in-law revealing their siblings. When the parents are unknown, add-sibling has already spawned a
**placeholder parent-couple** (ADR-0017, dashed inert bridge) that serves as the bus.
