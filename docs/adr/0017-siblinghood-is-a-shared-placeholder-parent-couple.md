# ADR-0017 — Siblinghood is stored as a shared placeholder parent-couple

Status: Accepted (2026-07-13)

Extends **ADR-0016** (kinship is a steward-governed, per-family tree of generative edges).

## Context

ADR-0016 stores only two generative primitives — **`parent-of`** and **`partnered-with`** — and
**derives** sibling/grandparent/cousin/in-law by walking the graph. "Sibling = shares a parent" is a
derived fact, never stored, so it can never contradict a stored one.

The tree renderer (`docs/99-pruned/superpowers/specs/2026-07-13-tree-ego-nav-redesign.md`) lets a user **add a
sibling** to a person directly from that person's card. But if the person has **no parents in the
data**, there is no shared parent to derive siblinghood from — and the model has no way to persist
"these two are siblings" as a standalone fact. Something has to give: either we forbid adding a sibling
to a parentless person, or adding a sibling must create the missing shared parent.

ADR-0016 already provides the material: an **unidentified bridge node** — a `persons` row with
`identified = false`, `origin = mention`, a null `displayName`, rendered from the relation, **never
reaped**, and **never invitable until identified**.

## Decision

**Adding a sibling to a person with no shared parent auto-creates a placeholder parent-couple.**

When "Add sibling" is invoked on person A, the write path **tops A's parents up to a couple** and shares
**both** with the new sibling B, eagerly and atomically. A v1 sibling shares **both** parents (sharing
only one is a *half*-sibling, which v1 defers), so:

- **A has 0 recorded parents** → mint **two** `identified = false, origin = mention` placeholder
  persons, partner them, and make each a `parent-of` both A and B.
- **A has exactly 1 recorded parent** → mint **one** placeholder to complete the couple (partner it to
  the existing parent), then make both parents `parent-of` B (and the new placeholder `parent-of` A, so
  A and B share the *same two* parents).
- **A already has a full parent-couple** → **reuse it**; add B as a child of that couple, no placeholders.

All minted `parent-of` edges carry `nature = unknown`; the shipped shortcut of minting a single shared
bridge parent (which yields half-siblings) is replaced by this top-up-to-a-couple rule.

The placeholders are rendered as the existing **dashed anonymous-bridge cards** and are **inert
containers**: no parent/sibling carets, no kebab — you cannot walk up from, or add to, an unknown
ghost. They follow ADR-0016's placeholder lifecycle (never reaped; identifying one — filling its
fields — flips `identified` to true, `origin` unchanged, at which point it becomes a normal card).

If A **already** has a full parent-couple, "Add sibling" reuses it (adds B as a child of that couple);
no placeholders are spawned.

## Consequences

- Siblinghood is always expressible through the two generative primitives — no new node type, no stored
  "sibling" edge, no contradiction risk. The tree's descent-bus (Model A) always has a parent container
  to hang siblings from.
- Adding a sibling **persists two ghost persons** into the family, referenced by edges (and possibly,
  later, by stories/mentions). This is the surprising part — it is why this ADR exists — and it is
  hard to reverse once those rows are referenced. It is mitigated by the placeholder lifecycle
  (inert, never reaped, identifiable in place).
- Half-siblings (a single shared parent) are a **deferred** future capability; when added, the
  two-placeholder default becomes a one-vs-two choice at add time.

## Alternatives considered

- **Forbid siblings without parents** — simplest, but makes the common "add my brother" gesture fail
  for anyone whose parents aren't in the tree yet. Rejected: hostile to the core flow.
- **A single shared placeholder parent** — half the ghost clutter, but yields *half*-siblings by the
  derivation rule, conflating a distinction v1 wants to keep clean. Rejected for v1.
- **A stored `sibling-of` edge** — violates ADR-0016's "only generative primitives" invariant and
  reintroduces the contradiction risk the derive-everything rule exists to prevent. Rejected.
