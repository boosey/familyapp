# Handoff — implement nearer-owns caret model in `/hub/tree` (ADR-0018)

Status: **Design done, not built.** Docs committed to master 2026-07-13. This handoff is self-contained;
you should not need the originating chat.

## What this is

The ego-centric `/hub/tree` renderer draws **redundant carets**: a revealed child shows a parent-caret
pointing back up at the parent that revealed it, and every sibling in an expanded fan keeps its own
sibling-caret. The fix is a caret-**ownership** rule. It is decided and documented; only the code and
tests remain.

## Read these first (all on master)

- **`docs/adr/0018-tree-carets-are-owned-by-the-anchor-nearer-node.md`** — the decision + rationale +
  rejected alternatives. The spine.
- **`docs/superpowers/specs/2026-07-13-tree-ego-nav-redesign.md`** §3 (rewritten) and §4 — the build
  contract, now expressed as nearer-owns.
- **`apps/web/app/hub/tree/CONTEXT.md`** — glossary (anchor, caret ownership, lineage-vs-collateral,
  sibling/child set ownership, in-laws, rule-8 coupling, collapse memory, out-of-scope).

## The rule in one line

> Every relationship is controlled by exactly **one** caret, owned by whichever endpoint is **nearer the
> anchor** along the path traveled to reach it. The farther endpoint shows no caret back toward the anchor.

The drawn tree is a spanning tree rooted at the anchor; each drawn node (except the anchor) has one
*discovery edge* to the node that revealed it, and that edge's caret lives on the **discoverer (nearer)
side**. A relationship whose both endpoints are drawn but was **not** a discovery edge (a laterally-
revealed sibling and its shared parent) carries **no caret at all**.

Per direction:

- **Parents ↑ / Children ↓ — direct lineage owned once.** The direct-lineage parent **never** shows a
  children-caret (its lineage child is on the bus; the anchor's other siblings come off that child's
  sibling-caret). A **descendant** shows **no** parent-caret back up. A couple hides its children-caret
  once **any** child is drawn via a nearer path.
- **Collateral children-caret stays.** An aunt/uncle, one of the anchor's own siblings, or a cousin —
  whose children are still hidden — **keeps** its children-caret (reveals cousins/nieces), or a **"+"**
  if childless. Not a duplicate: no nearer node owns that edge.
- **Siblings ↔ — one owner per set.** Shown only on the **set-owner** (the anchor, a partner, or a
  lineage parent reached via a parent-caret). A **set-member** (revealed child, fanned sibling, cousin,
  niece) shows **no** sibling affordance at all — not even a "+" for an only child.
- **In-laws — no carve-out.** Every drawn partner is a full member with its **own** ↑/↔ carets; ↓ is the
  couple's single shared control on the anchor-nearer side. (Supersedes the old rule 9.)
- **Rule-8 coupling (all sibling-set owners):** expanding a sibling-caret auto-expands that owner's
  parents (the shared bus); closing parents closes siblings; closing siblings keeps parents. Unknown
  parents → the ADR-0017 placeholder couple is the bus.
- **Collapse** hides but **remembers** (suppress via `collapsed*`, do not purge descendants'
  `expanded*` flags); re-expand restores the nested sub-shape.

## Where the code is

`apps/web/app/hub/tree/tree-layout.ts` — pure, DOM-free, unit-testable. The affordance loop is
**`for (const p of placed) { ... }` at ~lines 711–822**. Today it emits **all three** affordances for
every placed identified node, with a single dedup (couple hides children-caret once a child is drawn,
~lines 701–709 + 784–819). That single dedup is why ancestors already look right.

## What changes (mostly deletion + two suppressions)

Reframe the loop from "emit all three per node" to "emit only what this node **owns**":

1. **Descendant parent-caret — suppress.** A node whose drawn parent(s) reached it via the parent's
   ownership (i.e. this node was discovered *from above* / is below the anchor on the direct lineage, or
   is a set-revealed child/cousin/niece) emits **no** parents affordance. Concretely: emit a parents ↑
   affordance only when this node **owns** the reveal of its parents — it is the anchor, a partner, or a
   node reached via its own parent-caret (a lineage parent / set-owner) — **and** its parents are hidden
   (caret) or absent (+). A descendant/set-member: nothing.
2. **Set-member sibling affordance — suppress.** Emit the siblings ↔ affordance **only on the set-owner**
   (anchor, partner, or lineage parent reached via parent-caret). Set-members (discovered via a children-
   caret or a sibling-caret): **nothing** — not even a "+".
3. **Children-caret dedup — keep, and confirm collaterals survive.** The existing "couple hides
   children-caret once a child is drawn" already suppresses the direct-lineage parent's children-caret.
   Verify a **collateral** couple (aunt/sibling/cousin) with **no** drawn child still emits its
   children-caret (reveal) or "+" — that one is **not** a bug.

The cleanest implementation is to track each drawn node's **discovery edge / discovery direction** during
the spanning-tree walk (the `visit()` / fixpoint block, ~lines 287–343), then key affordance emission off
"what did this node own vs. how was it discovered." An explicit `discoveredVia: 'anchor' | 'parent-caret'
| 'child-set' | 'sibling-set' | 'partner'` per drawn node makes rules 1–3 mechanical. Prefer this over
ad-hoc generation checks — generation is wrong for collaterals (a cousin sits in the anchor's own row).

Do **not** special-case in-laws or use absolute generation for ownership. Nearer-owns is the only rule.

## Regression tests (required — one per killed bug)

Pure-layout tests in `apps/web/app/hub/tree/tree-layout.test.ts` (assert on the returned `affordances[]`):

1. **No parent-caret on a revealed child.** Anchor with a child expanded → the child node has **no**
   `direction: 'parents'` affordance; the anchor's couple owns the `children` control.
2. **No sibling affordance on a fanned sibling.** Anchor with siblings expanded → each fanned sibling has
   **no** `direction: 'siblings'` affordance; only the anchor does (expanded).
3. **Collateral children-caret survives.** Expand up to a parent, expand the parent's siblings (aunts) →
   an aunt with hidden children still has a `direction: 'children'`, `kind: 'caret'` affordance.

Also worth covering: only-child revealed child has **no** sibling "+"; in-law partner of a child has its
**own** parents ↑ caret; collapse-then-re-expand restores a nested grandchild expansion.

## Scope / deferred (do not build)

Half-siblings, multiple partners / children-across-unions, same-person-on-two-paths (cousin marriage /
pedigree collapse), step/adoptive distinctions. See ADR-0018 "Alternatives / scope."

## Worktree note

The design was done from `.claude/worktrees/issue-31-edge-model`, which was **unpopulated** (empty working
tree; git resolved to the main repo). That worktree is being removed as part of this handoff. Build the
implementation from the main repo on a fresh branch off master, or a freshly-created worktree.

## Author / deploy gotcha

Vercel blocks deploys unless the commit author is **boosey** (`boosey.boudreaux@gmail.com`, set repo-local).
Docs-only changes are additive (no migration). The impl is client-side layout only — no schema/migration.
