# ADR-0018 — Tree carets are owned by the anchor-nearer node (spanning-tree ownership)

Status: Accepted (2026-07-13)

Refines the caret model of `docs/99-pruned/superpowers/specs/2026-07-13-tree-ego-nav-redesign.md` (ego-centric
`/hub/tree`). Builds on **ADR-0016** (derived kinship) and **ADR-0017** (placeholder parent-couple).

## Context

The shipped ego-centric tree gave **every** drawn card up to three directional affordances — parents
↑, siblings ↔, children ↓ — with a single dedup (a couple hides its children-caret once a child is
drawn). In practice this produced **redundant carets**: two controls for one relationship. A revealed
child showed a parent-caret pointing back up at the very parent whose children-caret revealed it; every
sibling in an expanded fan kept its own sibling-caret even though the whole set was already on screen.
Users saw "multiple carets on a parent-child relationship" and "a sibling-caret on siblings that are
already expanded."

The spec's original §3 framed suppression as *"an expanded ancestor couple carries no children-caret"*
— true for the direct lineage, but stated as a generation fact. Generation-relative framing ("anyone
above the anchor has no children-caret") breaks on **collateral** kin: a cousin sits in the anchor's
own generation but is reached by going **up** to an aunt then **down**; an aunt sits in the parents'
generation but must keep a children-caret to reveal cousins. There is no consistent "up/down vs the
anchor's row" rule that both kills the redundant carets *and* keeps the collateral ones.

## Decision

**A caret is owned by the endpoint nearer the anchor.** The drawn tree is a spanning tree rooted at
the anchor: every drawn person except the anchor has exactly one *discovery edge* to the node that
revealed it. The control for a relationship lives on the **discoverer (anchor-nearer) side**; the
farther endpoint never shows a caret pointing back toward the anchor.

Concretely, each drawn person shows, per direction, **at most one** of: a **caret** (kin hidden that
way that this person is the nearest owner of), a **"+"** (no kin that way and this person owns the
reveal), or **nothing** (the kin are already drawn, or the reveal is owned by a nearer node).

- **Parents ↑ / children ↓** — the direct-lineage parent↔child edge is owned once. Going up, the anchor
  (or lower node) owns the parent-caret; the parent shows no children-caret back down. Going down, the
  parent owns the children-caret; the child shows no parent-caret back up. A couple hides its
  children-caret once **any** child is drawn via a nearer path (the lineage child), so the other
  children (the anchor's siblings) are reached off that child's sibling-caret, never a second
  children-caret. A **collateral** couple (aunt, sibling, cousin) whose children are still hidden
  **keeps** its children-caret — that is the only way to reach cousins/nieces, and it is not a
  duplicate because no nearer node owns that edge.
- **Siblings ↔** — a sibling set has exactly one owning control, on the **set-owner**: the anchor, a
  partner, or a lineage parent reached via a parent-caret. A person reached as a **set-member** (a
  revealed child, a fanned sibling, a cousin, a niece) shows **no** sibling affordance at all — not even
  a "+", because "add a sibling" there is "add a child to the owning parent," which is that parent's
  control. Expanding a sibling-caret auto-expands the owner's parents (the shared descent bus,
  ADR-0017); closing the parents closes the siblings; closing the siblings leaves the parents.
- **In-laws** — every drawn partner is a full tree member with its own ↑/↔ carets toward its own hidden
  kin; the children ↓ control is the couple's single shared caret on the anchor-nearer side. There is
  no in-law carve-out; the nearer-owns invariant alone governs.

Collapsing a caret **hides but remembers** the sub-shape; re-expanding restores the prior nested state.

## Consequences

- No relationship is ever governed by two carets; the redundant parent-caret-on-children and
  sibling-caret-on-fanned-siblings both disappear, while the aunt/sibling children-caret that reaches
  cousins/nieces correctly stays.
- The rule is uniform and recursive — it needs no notion of absolute generation, only "nearer to the
  anchor along the traversal." This is the surprising part (a reader expecting a generation rule will
  ask why an aunt has a children-caret but a grandparent does not); the answer is that the grandparent's
  lineage child is already drawn and nearer, and the aunt's children are not.
- Implementation is largely **deletion** in `tree-layout.ts`: the "emit all three per node" loop
  becomes "emit only what this node owns." Purely at the layout level, so it is unit-testable without
  the DOM.
- Hard to reverse: this is the spine of all caret logic and of the collapse/expand state model. Chosen
  over the rejected alternatives below for specific reasons.

## Alternatives considered

- **Global generation direction** (anyone above the anchor: no children-caret; below: no parent-caret).
  Simple to state, but undefined for collateral kin (a cousin is in the anchor's own row) and it would
  suppress the aunt's cousin-revealing caret. Rejected.
- **Restricted in-laws** (only the anchor's and ancestors' partners expandable, per the spec's original
  rule 9). An arbitrary line — why can the anchor's spouse reveal her parents but a child's spouse
  cannot? Rejected in favor of the uniform nearer-owns rule.
- **Reset-on-collapse** (collapsing forgets the sub-shape; re-expand shows one fresh hop). Stateless and
  matches the "prune the whole branch" language, but loses a laboriously-built deep expansion on an
  accidental collapse. Rejected for restore-nested, which the existing `expanded*`/`collapsed*` set
  model already supports by suppressing rather than purging.
