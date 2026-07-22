# ADR-0027 — Family tab Tree owns placement; blended kin via forms and zones

Status: Accepted (2026-07-21)

Extends **ADR-0016** (generative edges only), **ADR-0017** (sibling via placeholder couple; half via
explicit this-parent-only), **ADR-0023** (membership ≠ tree placement; List/Tree IA split). Parent
epic: issue #281; docs lock: issue #282.

## Context

The Family tab had grown incoherent: List still hosted relationship governance and unplaced
placement; Tree placement was modal-heavy; blended families (multi-partner, half/step) were deferred
in UI even though `parent-of` / `partnered-with` and `nature` already model them.

Issue #281 grilled the IA and write rules. This ADR locks the Tree-side decisions so later tickets
(#283–#289) share one vocabulary. **No schema enum changes** — the existing two primitives and
`nature` (`biological | adoptive | step | foster | unknown`) already cover the cases. Half-sibling
and step-sibling remain **derived labels**, never new edge types.

## Decision

### Partner-add offers step parent-of (never silent)

When a person who already has children gains a new `partnered-with` edge, the write path **prompts**
for a step `parent-of` from the new partner to each existing child. Accepting writes
`nature = step`; declining writes only the partnership. Silent auto-attachment is forbidden — same
**offer-never-silent** discipline as Dedup-on-invite and the Finish check.

### Multi-partner is allowed

A Person may hold more than one `partnered-with` edge. Placement UI must not force a single-partner
assumption. Each partnership is an ordinary undirected edge; children attach via ordinary `parent-of`
(with `nature` as appropriate). No new primitive.

### Zone-based placement with confirm

Placing someone relative to a focus node uses **zones**, not free-form graph inventing:

- **Top** → parent of the focus
- **Bottom** → child of the focus
- **Side** → partner only

A zone choice always goes through a **confirm** step before any kinship ledger write (co-parent
checkboxes on child placement; partner→children offer on partner placement; nature when relevant).
**This parent only** on child-drop yields half-siblings by derivation (ADR-0017 amendment); selecting
both co-parents yields full siblings.

### Line-hit only on generative (stored) edges

Canvas line-click / line-tap governance targets **stored** `parent-of` and `partnered-with` edges
only. Derived relationships (sibling, cousin, …) have no stored stroke to govern — you govern the
generative edges that produce them.

### Mobile Place ≠ drag

On mobile, **Place** is a deliberate tap → zone → confirm flow. It is **not** canvas drag-and-drop.
Desktop may use tray → zone DnD as a convenience path into the **same** confirm step; mobile does
not pretend drag is the primary gesture.

### Schema enums unchanged

No new kinship edge kinds, no new `nature` values, no stored sibling/half/step edges. Writes stay
generative only; labels are derived.

## Considered options

- **Silent step parent-of on partner-add** — rejected. Blended families are exactly where silent
  assertion hurts; offer-never-silent wins.
- **New `half-sibling-of` / `step-sibling-of` edge types** — rejected. Violates ADR-0016; contradicts
  the derive-everything rule.
- **Keep placement and governance on List** — rejected. List becomes browse-only; Tree owns place /
  relate / govern (ADR-0023 amendment).
- **Mobile canvas drag as Place** — rejected for Phase B. Tap → zone → confirm is the mobile path;
  drag remains a desktop convenience into the shared confirm.

## Consequences

- Later Family-tab tickets share one IA: List = index; Tree = tray + zones + governance.
- Partner and child placement surfaces must implement offers/checkboxes before ledger writes.
- Derived half/step labels (#284) are presentation over existing edges — no migration.
- Line-governance (#289) scopes hit-testing to stored generative edges only.
- GEDCOM, reconcile, challenge redesign, and Requests redesign remain out of scope here.
