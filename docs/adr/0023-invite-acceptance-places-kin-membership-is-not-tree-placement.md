# ADR-0023 — Invite acceptance places kin; membership is surfaced independently of the tree

Status: Accepted (2026-07-18)

Extends ADR-0016 (kinship is a steward-governed per-family tree), ADR-0017 (siblinghood via a
shared placeholder couple), ADR-0001 (family discovery & join requests). Full rationale, schema
deltas, and build sequence: `docs/design/2026-07-18-membership-vs-kinship-and-invite-placement.md`.

## Context

ADR-0016 deliberately separated **membership** (participation) from **kinship** (genealogy): "kinship
must not be conflated with [membership]... and must never grant content access." It established
*tree ⊋ members* (not every relative is a member) but was silent on the mirror case.

Production surfaced that mirror case. An invited member who joined and accepted correctly — right
Person, active membership, no duplicate — was invisible in the hub's **Family tab**, because that
tab renders *only* the kinship graph (tree walk + derived kin) and never reads `memberships`. Eight
of ten members in that family had no kinship edge and so did not appear.

Two structural gaps caused and sustained it:

1. **The invite discarded the relationship.** The invite captured `relationship_label = "Son"`, but
   acceptance wrote only the membership and dropped the label into a free-text column nothing reads.
   The exact fact needed to place the member was collected and thrown away.
2. **There was no way to see or fix an orphan.** No surface lists members-without-edges; the
   add-relative flow only *mints new* Persons (cannot link an existing member); and no steward
   action can remove a member (`status='ended'` exists in schema but nothing sets it).

## Decision

**Invitation acceptance auto-asserts a kinship edge from a structured relationship.** The invite
relationship becomes a fixed picker — `Wife · Husband · Mother · Father · Son · Daughter · Other` —
and on acceptance the two **direct primitives** are written silently (`partnered_with` for
spouse; `parent_of` for parent/child, directed by the picked relationship role (invitee → inviter when Mother/Father are chosen; inviter → invitee when Son/Daughter are chosen)) and the invitee's `sex` is
set. This is in-model: the inviter is an active member with authority to assert, governance is
*first-asserter-wins with no endpoint confirmation* (ADR-0016), the subject retains the **hide
veto**, and the steward retains **deny/correct**. Only fresh, structured, direct-primitive intent
auto-writes; relationships needing bridge nodes (sibling, grandparent — ADR-0017) do not.

**"Other" is not "non-family."** Other means "a relationship the picker can't express yet." Such
members become **unplaced**, resolved later by a human in the placement UX — never silently
classified at invite time.

**Membership is surfaced independently of tree placement.** Unplaced members (those with a
membership but no kinship edge) are shown in **both** the Tree and List views — the tree canvas
gains a home for edge-less nodes. A **"link existing member"** capability is added to the
add-relative flow (the missing inverse of "mint a new Person"). Any active member may place
(first-asserter-wins); the steward may override at any time. A **"leave as non-family member"**
action persists a **per-family** flag on the membership to remove a member from the unplaced surface
permanently.

**A member is removable.** A steward-only `endMembership` sets `status='ended'` + `ended_at`.
`memberships` is the revocable link (mutable status, unlike the append-only consent ledger).
Removal revokes **content access only**: the person's authored stories stay theirs and their
**kinship edge remains** in the tree (kinship ≠ membership).

**Invitations remain one-family.** One invitation targets exactly one family; relationship, role,
governance, and the invitee's consent to join are all per-family, so bundling would force
all-or-nothing consent. Multi-family membership is done via multiple invitations (epic #115
reconciliation dedups the person).

## Considered options

- **Invent non-genealogical edge types** (`friend_of`, `caregiver_of`) to place non-kin on the tree
  — *rejected*. ADR-0016 already rejected enumerated relationship types; such edges are
  non-generative and put untrue claims into the genealogy graph. A non-family member is the
  *absence* of an edge, not a new one.
- **Silent backfill of existing orphans** from stored free-text labels — *rejected*. Old labels are
  unconstrained free text ("Sister"); machine-writing them into the append-only ledger without a
  human tap is exactly the "offer-never-silent" move ADR-0016 warns against. (Deferred entirely as a
  one-off; orphans just appear in the placement queue.)
- **Single invitation joining multiple families** — *rejected*. Relationship/role/governance/consent
  are per-family; bundling breaks granular consent. A deferred multi-select *fan-out* into N
  independent invitations is the convenience path instead.
- **Steward approval-before-send gate now** — *deferred*. It is prevention; `remove-member` is the
  correction it presupposes. Building the correction makes deferring the gate safe; building neither
  would leave "any member can invite" with no brake and no reverse gear.

## Consequences

- **The Family tab stops being a pure kinship projection.** It must render membership-only nodes
  (unplaced tray) in both views — a renderer change, and a subtle re-widening of what "the tree"
  shows (structure only; kinship still never grants content access — ADR-0016 holds).
- **Acceptance now writes to the kinship ledger.** A new audited write path (invite-accept →
  `parent_of`/`partnered_with`) subject to the same governance overlay; a mis-picked relationship is
  corrected by subject-hide or steward deny/correct, not by editing (append-only).
- **A new stored per-family bit** ("non-family member") is accepted, despite membership-minus-edge
  otherwise needing no schema — the price of an un-nagging placement queue.
- **`remove-member` closes a real governance hole** but introduces the first membership-ending write;
  ending a membership must leave authored content and tree placement intact.
- **Steward workload grows again** (curating unplaced members) — same authority, extended, as with
  every ADR-0016 governance addition.
