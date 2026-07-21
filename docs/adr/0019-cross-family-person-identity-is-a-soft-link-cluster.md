# ADR-0019 — Cross-family person identity is a soft-link cluster, never a physical merge

Status: Accepted (2026-07-14)

Builds on **ADR-0016** (kinship is a steward-governed per-family tree) and the family scope selector.
Full design + build plan: `docs/99-pruned/superpowers/specs/2026-07-14-multi-family-reconciliation-design.md`.

## Context

A Person can already belong to many families — one `persons` row with N `memberships`. But nothing
records that the accountless **`mention`** "Grandma Eleanor" typed independently into the Boudreaux tree
and the one typed into the Carney tree are the **same real human**. ADR-0016 named this seam
("reconciliation") and deferred it, ruling only that any such merge must be *human-confirmed, never
silent*. This ADR fills the seam.

Two industry answers frame the choice. **FamilySearch** keeps one shared node per *deceased* real
person (privacy-safe because the dead can't be harmed) and keeps *living* people as private, unmerged,
per-user rows. **Ancestry** keeps a separate tree per user and never merges — it soft-links duplicates
with "hints." Our consent-first posture and per-family Steward governance (ADR-0016) push us toward the
Ancestry grain for the living, with the FamilySearch merge available *only* for the dead, later.

The hard constraint: cross-family sameness ("the Eleanor here is the Eleanor there") is **itself a
consent-sensitive disclosure** — it reveals that a person participates in both families. The design must
let combined multi-family views work without leaking that fact to people not already entitled to it.

## Decision

**Two populations; the common one needs nothing.** Account-holders are multi-family *today* via one row
+ many memberships — no clone, no new entity. Reconciliation concerns **only** accountless `mention`s
duplicated across families, plus the moment such a mention becomes an account.

**Belonging is membership; depiction is not belonging.** Belonging to a family = an active `membership`
the person accepted (the sole grant of feed + content, via membership + consent). Being *depicted* (a
tree `mention`, a story-subject tag) grants nothing and obligates nothing. **No one is ever auto-joined.**
A person's feed is the union of families they belong to, filtered by scope. **Reconciliation unifies
identity, never membership**, and identity linkage **never widens the content front door** — exactly as
kinship never drives authorization (ADR-0016).

**Soft link, never physical merge.** Sameness is recorded as an append-only **`person_identity_links`**
ledger row (`same_as`), guarded like `@chronicle/db/content` and `@chronicle/db/kinship`. The two
`persons` rows are **never collapsed**. "One Eleanor" is a **cluster resolved at render time, per
viewer** — never a stored object. `same_as` is transitive, so a cluster is a union-find closure over the
links; a bad link can *poison-merge* two clusters, so the resolver is defensive and a challenge cuts one
edge without shattering the cluster. Physical fusion into a single row is reserved for a **future,
deceased-only** step (no privacy interest, no veto-holder to override) and is out of scope here.

**Who may assert sameness (disclosure rule).** A **dual-member** — a person with an active membership in
**both** families — may confirm a `same_as`. This equals the population that can already *see* both
sides. Crucially the link is **consumed only in a viewer's combined view across families the viewer
belongs to**: a single-family viewer never learns cross-family sameness, so the link creates **no new
disclosure** beyond what the confirmer already had.

**Governance — three append-only levers**, mirroring the Consent ledger and ADR-0016:
1. **Subject veto (global).** Once the subject has an account, being declared "the same as" is an
   identity claim *about them*; they can break any `same_as` about themselves everywhere — overriding
   even a Steward, exactly as the subject-hide veto does.
2. **Dual-member challenge.** Any dual-member may supersede a link.
3. **Steward deny-for-my-family.** No single Steward *owns* a cross-family link, but each governs whether
   it is **honored in their own family's combined view** — deny suppresses the collapse for that family
   only; the link persists and the other family may still honor it. This is the per-family surfacing
   pattern kinship edges already use.

**Reconciliation on join is proactive and gentle.** When a person joins a family that already holds a
matching `mention`, the matcher runs and *invites* them to claim the depiction ("Carney's tree already
includes someone who might be you — is this you?"). Confirm → `same_as`; the subject-veto then attaches
to that depiction, transferring consent authority from Steward-only to the actual subject.

**Match-on-add is scoped to the adder's own families, precision-tuned.** Adding a relative searches the
**union of families the adder belongs to** (never global — that would disclose strangers), scoring on
name similarity + birth-year proximity + overlapping derived kin, surfacing a hint only above a
confidence bar (erring toward **fewer** hints). The user chooses **link / add-new / not-sure** (a
deferrable pending suggestion).

## Considered options

- **One row, many families (physical unify, FamilySearch-for-all):** rejected — a shared node is a
  cross-Steward destructive write and leaks living people between families by construction (the exact
  cross-family PII class already patched once in `resolveKinshipTree`).
- **Global match / global hints (Ancestry hint engine):** rejected — discloses the existence of people
  the adder has no relationship to, against the posture. Match scope is the adder's families only.
- **Subject-only confirmation:** rejected as the *default* — strongest consent but stalls all matching
  until the subject joins; the subject retains an absolute *veto* instead, which recovers the guarantee
  without the stall.
- **Merged super-tree as the default render:** deferred — genuinely useful for deep-ancestor genealogy
  but where the layout complexity and visual density live; ships as an opt-in toggle, not v1 default.

## Consequences

- **"One real person" is a cluster, not a row.** Every combined-view consumer — the tree, stories-about,
  avatars, the feed — gains a render-time cluster-resolution step scoped to the viewer's families. This
  is the standing complexity tax we accept in exchange for never leaking cross-family identity.
- **The tree renders one family at a time with "also in …" bridge badges** (tap to hop); the merged
  super-tree is a later opt-in. Per-family clarity and governance grain are preserved.
- **`person_identity_links` needs its own authorization surface** (own core function + architecture-test
  allowlist entry), parallel to kinship — a distinct data category that never grants content access.
- **A living person can be depicted in a family they cannot see, and cannot veto it until a bridge (a
  dual-member, or joining) exists.** Inherent — one cannot consent to what one cannot discover; the same
  gap exists in FamilySearch/Ancestry. Accepted, and mitigated by the proactive join-time offer.
- **Deceased physical merge (ADR-0016's Option C) and GEDCOM/API import reconciliation** slot on top of
  this soft-link core additively, reusing the same ledger and cluster resolver.
