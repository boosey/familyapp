# Spec — Family tree interaction redesign (ego-centric, expand-in-place)

Status: Accepted design (2026-07-13). **Supersedes** the three pedigree-nav specs
(`2026-07-12-kinship-tree-viz-design.md`, `-pedigree-nav-design.md`,
`-interactions-design.md`) for `/hub/tree`. Implements ADR-0016 (kinship tree), ADR-0017
(siblinghood via a placeholder parent-couple), and ADR-0018 (nearer-owns caret ownership).

This spec is the build contract for the `/hub/tree` renderer rewrite. It replaces the shipped
FamilySearch-style re-rootable pedigree with an **ego-centric, expand/collapse-in-place** tree.

---

## 1. Mental model

The tree is a fixed, pannable canvas centered on a **focus person** (see glossary). There is **no
selection state, no re-rooting, and no visual distinction for the focus or the viewer.** After load,
the only interactions are:

- **Carets** — per-direction expand/collapse of a card's kin (parents ↑, siblings ↔, children ↓).
- **"+" affordances** — where a direction has *no* kin in the data, the caret is replaced by a "+"
  that starts adding a relative in that direction.
- **Per-card kebab (⋮)** — add-relative menu; the only global-ish menu, and it is per-card, not global.
- **Name click** — opens the read-only **detail panel**.
- **Drag** — pans the canvas.

The tree is **generation-stacked vertically**: ancestors above (smaller y), descendants below,
within-generation stacking horizontal (x). No zoom in v1.

### The focus person

- Determined by the entry point: the person whose menu you chose "view in tree" from (via the
  `?anchor=` / `?root=` deep-link param), **or** the logged-in user for a direct Tree-tab visit.
- It only seeds the **initial framing and initial expansion**. It is not selectable, not
  re-rootable, and carries **no** visual marker. There is no "You" label or accent border on any card.

### Initial expansion (focus-only)

From the focus F: **parents expanded** (F's parent couple shown, if any) and **children expanded**
(F+partner's children shown, if any); **siblings collapsed**; everything one hop only. If F has a
partner P, P is drawn (partners are always adjacent) but **P's** parents/siblings start collapsed —
initial expansion applies to F, not P. Children are the couple's shared set.

---

## 2. The card (rule 4)

Top-to-bottom: **Avatar · Name · Dates**. Every card is uniform — no relation line, no "You" label.

- **Avatar** — the person's photo/image if present; else the deterministic colored-initial
  **monogram** (hash of `personId`, stable across renders); else `?`.
- **Name** — display name; the **click target that opens the detail panel**. An
  identified-but-nameless person shows a fallback ("Unknown relative").
- **Dates (dob–dod), dates only** — deceased: `1948–1998`; living: `1948–`; degrade gracefully when a
  year is unknown (show what's known, e.g. `1948–` or `–1998` or empty). **No** "in memory" phrase,
  **no** muted tint — death is conveyed by the dates alone.
- **Sex bar** — the top-edge accent colored by sex (male/female/neutral) is **kept**. Sex also drives
  partner ordering (§4).
- **Anonymous bridge** (`identified === false`) — dashed border, `?` avatar, italic
  "Unknown &lt;relation&gt;", no dates. These are the placeholder container nodes (ADR-0017); they are
  **inert**: no parent-caret, no sibling-caret, no kebab — only the children-bus that justifies them.

### Kebab (rule 2/3)

Per-card, top-right of the card, **no border** (the carets/"+" have a border; the kebab does not).
Same options as today, gated by loaded adjacency:

- Add child — always · Add sibling — always
- Add parent — only when parent count < 2 · Add partner — only when partner count === 0

There is **no global toolbar kebab** — remove it.

### Detail panel

Opens on **name click**. Read-only/navigational; **never** re-roots (the "Center tree here" action is
removed). Shows name, **relation-to-viewer** ("your aunt" — relative to the logged-in user, not the
focus), and navigational links (stories / mentions / photos — some TBD). Add-relative links anchored on
the person are retained. More personal detail fields are TBD (out of scope for this pass; leave a seam).

---

## 3. Carets and "+" — nearer-owns ownership (ADR-0018)

Each **identified** card shows, per direction, **at most one** affordance. A direction shows:

- a **caret** if there is kin hidden that way **that this card is the nearest owner of** (or a drawn
  branch that way to collapse), or
- a **"+"** if there is no kin that way **and this card owns the reveal** (starts add-in-that-direction), or
- **nothing** — the kin that way are already drawn, or the reveal is owned by a node nearer the anchor.

Carets and "+" have a **1px circular border**. Placement (thin gutter off the card edge):

- **Parents ↑** — centered above the top border. Points **up = collapsed**, **down = expanded**.
  Per-person (in a couple, each partner has their own parent caret above their own card).
- **Siblings ↔** — centered outside a **side** border. **Single man / left partner → left side;
  single woman / right partner → right side; single unspecified-sex → left** (deterministic default).
  Points **toward the card = collapsed**, **away = expanded**.
- **Children ↓** — centered below the bottom border. Points **up = collapsed**, **down = expanded**.
  Per **couple** (shared), not per-person (§5).

### The invariant (ADR-0018)

> **Every relationship is controlled by exactly one caret, owned by whichever endpoint is *nearer the
> anchor* along the path traveled to reach it.** The farther endpoint never shows a caret pointing back
> toward the anchor.

The drawn tree is a spanning tree rooted at the anchor; each drawn person (except the anchor) has one
*discovery edge* to the node that revealed it, and that edge's caret lives on the **discoverer (nearer)
side**. "Up from the anchor / down from the anchor" is just this rule applied to the direct lineage.
A relationship whose **both** endpoints are already drawn but which was *not* a discovery edge (a
laterally-revealed sibling and its shared parent) carries **no caret at all**.

Direction-by-direction:

- **Parents ↑ / Children ↓ — direct lineage owned once.** Going up, the anchor (or lower node) owns the
  parent-caret; the parent shows **no** children-caret back down. Going down, the parent owns the
  children-caret; the child shows **no** parent-caret back up. A couple hides its children-caret once
  **any** child is drawn via a nearer path — so a **direct-lineage parent never shows a children-caret**
  (its lineage child is on the bus; the anchor's other siblings come off that child's sibling-caret).
- **Collateral children-caret stays.** A **collateral** couple — an aunt/uncle, one of the anchor's own
  siblings, a cousin — whose children are still hidden **keeps** its children-caret (→ reveals
  cousins / nieces-nephews), or a **"+"** if childless. This is not a duplicate: no nearer node owns
  that edge. (Rules 3/4 therefore constrain the **direct lineage only**, not everyone in a row.)
- **Siblings ↔ — one owner per set.** A sibling set has exactly one owning control, shown only on the
  **set-owner**: the anchor, a partner, or a lineage parent reached via a parent-caret. A person reached
  as a **set-member** — a revealed child, a fanned sibling, a cousin, a niece — shows **no** sibling
  affordance at all, **not even a "+"** for an only child (reconciles rules 6 & 7). "Add a sibling"
  there is "add a child to the owning parent," which is that parent's control (or the kebab).
- **In-laws — no carve-out.** Every drawn partner is a full member with its **own** ↑/↔ carets toward
  its own hidden kin (a child's spouse can reveal the co-in-laws; a cousin's spouse can reveal their
  family). The ↓ children-caret is the couple's **single** shared control on the anchor-nearer side.
  This **supersedes** the narrower rule 9 (which named only anchor/ancestor partners).

### Collapse / re-expand

Collapsing a caret **hides but remembers** the branch beyond it; re-expanding restores the prior nested
state exactly. Collapse *suppresses* (via the `collapsed*` sets), it does not purge descendants'
expansion flags — "instantly re-expandable" means no round-trip **and** no loss of sub-shape.

---

## 4. Siblings — Model A (rules 7–8)

Siblings hang off the **shared parent couple's descent bus** — they are not a separate horizontal bus
through the siblings themselves. Placement is **ego-side**: expanding F's sibling-caret fans F's
siblings to the caret's side; **F stays pinned at that end of the bus** (not its birth-order slot).
Within the fanned run, order by birth with **oldest farthest** from F (age reads monotonically
outward). The parent bus (§6) widens to span F + siblings with a riser to each.

**Rule 8 coupling (generalized to every sibling-set owner, ADR-0018).** Because siblings need the
shared parent-couple as their bus, expanding **any** sibling-set owner's sibling-caret **auto-expands
that owner's parents**; **closing the parents closes the siblings** (the bus vanishes); **closing the
siblings leaves the parents** (the bus stands alone). This holds for the anchor, for a lineage parent
revealing aunts/uncles (auto-expands the grandparents), and for an in-law revealing their siblings.
When the owner's parents are unknown, add-sibling has already spawned a **placeholder parent-couple**
(ADR-0017, dashed inert bridge) that serves as the bus.

Half-siblings are **deferred** (a sibling shares *both* parents in v1); likewise multiple partners,
cousin-marriage double-paths, and step/adoptive distinctions (see ADR-0018 scope).

---

## 5. Partnerships (rule 5, rule 10)

- **Adjacent** with a small separation. Nominal man/woman: **man on the left**. Same-sex or
  unspecified: position by **entry order** (edge `created_at`, then `personId` as final tiebreak) —
  **deterministic, never random**.
- **Caret ownership:** parents ↑ **per-person** (each partner's own, incl. in-laws); siblings ↔
  **per-person on outer sides** (left partner far-left, right partner far-right; the gap between
  partners never holds a sibling caret); children ↓ **shared, one bus** under the couple.
- **v1 single-partner:** a person has at most one partner; every child hangs off exactly one couple's
  bus. Multi-partner / children-across-unions is out of scope.

---

## 6. Descent-bus geometry (rule 10)

Two-parent case: a short edge drops from each partner's bottom-center; the two join at a horizontal
segment; from that segment's center a vertical drops a short length. **One child** → the vertical
enters the child's top-center. **Multiple children** → the vertical meets a horizontal bar at its
center; the bar spans from the top-center of the leftmost child to the top-center of the rightmost;
from the bar, verticals drop to each child's top-center.

Single-parent case (no partner): the bus drops straight from the lone card's bottom-center; same
join/riser geometry below, one feeder instead of two.

---

## 7. Data loading — prefetch one layer past the frontier

Every **drawn** card always has its immediate kin (parents/children/siblings/partner) already loaded
in memory even while collapsed, so:

- Expanding a caret is **instant** — no blocking spinner on the interaction path.
- Caret-vs-"+" is decided accurately from prefetched knowledge (kin exist → caret; none → "+").

After each expansion, a **background** fetch tops the buffer back up to one-layer-ahead. Keep a slimmed
`fetch`/`merge` path for this background top-up, but it is **off the critical path** — not a visible
blocking caret state. **Remove the re-root machinery** entirely (`onRecenter`, `relabelToRoot`, the
"Center tree here" path). Collapsing a direction prunes the **whole branch beyond it**, client-side and
instantly re-expandable.

---

## 8. Edge cases (coverage sweep)

- **Isolated focus (no kin):** just the focus card with **"+" on all three directions** and Add-partner
  via kebab. No special empty-state page — the tree is the empty state.
- **Same person on two lineage paths** (cousin marriage / shared ancestor): drawn **once**, deduped by
  `personId`; first caret to reveal them wins. No pedigree-collapse artwork in v1.
- **Placeholder bridge parents:** inert containers (see §2) — children-bus only.

---

## 9. What changes in the code (map, not prescription)

- `person-node.tsx` — card rewrite (avatar photo→monogram, dates-only, no relation line, no "You",
  keep sex bar, dashed bridge).
- `tree-layout.ts` — **nearer-owns caret model** (ADR-0018): emit only the affordance each node *owns*
  (not "all three per node"). Per-person parent/sibling, per-couple children; direct-lineage parent has
  no children-caret, set-members have no sibling affordance, collaterals keep their children-caret;
  ego-side sibling fan; single/two-parent bus geometry; `"+"` slots only where the node owns the reveal.
- `tree-canvas.tsx` — remove re-root/selection-as-navigation; keep name→panel; prefetch-one-layer;
  1px-border carets and "+"; per-card kebab only.
- `kebab-menu.tsx` — per-card only, borderless trigger; drop the global instance.
- `person-panel.tsx` — remove "Center tree here"; relation-to-viewer; keep nav links.
- `page.tsx` — drop the global toolbar/kebab; wire the prefetch load; `?anchor=`/`?root=` → focus.
- `@chronicle/core` kinship write — **`addSibling`** auto-spawns the placeholder parent-couple
  (ADR-0017). Tests + a companion regression test.
