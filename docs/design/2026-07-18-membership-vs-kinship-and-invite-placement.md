# Membership vs. the family tree — invite-time placement, unplaced members, member removal

Date: 2026-07-18
Status: accepted design (grilled with owner); implementation not yet started
Grounding: extends ADR-0016 (kinship model), ADR-0017 (siblinghood via placeholder couple),
ADR-0001 (family discovery & join requests). Codified as ADR-0023.

---

## 1. The incident that started this

In production, `alexboudreaux19@gmail.com` was invited to *The Jerry Boudreaux Family*, joined,
and accepted — every row is correct:

- Account + self-Person created, `identified=true`.
- Invitation `status=accepted`, `invitee_person_id == accepted_person_id` (reconciliation from
  epic #115 worked — **no duplicate Person**).
- `memberships` row: role `member`, **`status=active`**.

Yet he did not appear in the hub's **Family tab**. Root cause: the Family tab renders *only the
kinship graph* — Tree view walks `kinship_assertions` from a root; List view (`listMyKin`) shows
the viewer's kin. **Neither reads `memberships`.** A member with no kinship edge is invisible there.
Alex was one of **8** such orphans in that family; only the steward (3 edges) and one member
(1 edge) were on the tree at all.

The sharper finding: John's invite **had** `relationship_label = "Son"`. The system asked the
relationship, the inviter answered, and **acceptance wrote the membership and discarded the
relationship** into a free-text column nothing reads. Alex wasn't orphaned for lack of data — he
was orphaned because we threw the data away.

(Immediate remediation already applied to prod: a hand-written `parent_of` John→Alex edge +
`sex=male`. The 7 other orphans were deliberately left for the new flow to handle — see §6.)

## 2. The framing decision

Per ADR-0016, **membership (participation) and kinship (genealogy) are orthogonal and diverge
permanently.** The tree is genealogy; some members simply aren't in it (a family friend, a
caregiver, an in-law's sibling). We do **not** conflate them and we do **not** invent new edge
types to force non-kin onto the tree.

- The tree keeps exactly two generative primitives: `parent_of` and `partnered_with`. Sibling,
  grandparent, cousin, in-law remain **derived** (ADR-0016) or bridged (ADR-0017).
- A **"non-family member" is not an edge type.** It is a membership with no kinship edge.
- ADR-0016 already established *tree ⊋ members* ("not every relative is a member"). This design
  adds the mirror case it was silent on: **member ∉ tree** is legitimate and permanent.

## 3. Prevention — capture the relationship, place it on accept

The invite already collects a relationship; we make it **structured and load-bearing** instead of
free text discarded at accept.

**Invite picker (fixed vocabulary):** `Wife · Husband · Mother · Father · Son · Daughter · Other`.

**On acceptance, auto-create the kinship edge silently.** This is in-model: the inviter is an
active member with authority to assert, ADR-0016 is *first-asserter-wins with no endpoint
confirmation*, the subject keeps the **hide veto**, and the steward keeps **deny/correct**. The
intent is fresh and structured (picked seconds earlier), so no confirmation step is warranted.

| Picker value | Edge created (inviter = actor) | Invitee `sex` |
|---|---|---|
| Wife | `partnered_with(inviter, invitee)` | female |
| Husband | `partnered_with(inviter, invitee)` | male |
| Mother | `parent_of(invitee → inviter)` | female |
| Father | `parent_of(invitee → inviter)` | male |
| Son | `parent_of(inviter → invitee)` | male |
| Daughter | `parent_of(inviter → invitee)` | female |
| Other | **no edge** — member is *unplaced* (see §4) | unchanged |

**"Other" ≠ non-family.** Other means "a relationship this picker can't express yet" — sibling,
grandparent, aunt/uncle, cousin, in-law, *and* genuine non-family. Those members land in the
**unplaced / yet-to-be-related** state and are resolved later in the placement UX, where the
distinction (real kin vs. leave as non-family) is actually made.

Only the **two direct primitives** auto-place. Anything requiring bridge/placeholder nodes
(sibling, grandparent, ADR-0017) is *not* auto-created from an invite — it routes to manual
placement.

## 4. Cure — the placement UX

1. **Unplaced members appear in *both* the Tree and List views.** The tree canvas must gain a home
   for **edge-less nodes** — a "not yet connected" tray/cluster at the margin, not woven into the
   pedigree. This is a real renderer change, not a query tweak.
2. **Placement mechanism — the core capability gap:** today `addRelative` *always mints a new
   Person*; there is **no way to link an existing member** into the tree. We extend the
   add-relative flow so it can attach an **existing member** to an anchor. The full relationship
   vocabulary (incl. sibling/grandparent via bridge nodes) is available here — richer than the
   invite's 6 primitives — while storage stays the two primitives.
3. **Who may place:** any active member can assert (first-asserter-wins). The steward can override
   (deny/correct) at any time. The unplaced-members surface is primarily the steward's curation
   view; the reciprocal "add relative → pick existing member" affordance lives on tree nodes too.
4. **"Leave as non-family member"** action dismisses a member from the unplaced surface. This
   **persists a per-family flag on the membership** (per-family because someone can be a caregiver
   in one family and a daughter in another). We accept this stored bit despite §2 saying non-family
   needs no schema — it's the cost of an un-nagging queue.

## 5. Invitations stay one-family

**One invitation = one family.** Relationship, role, governance, and *the invitee's consent to
join* are all per-family; bundling would force all-or-nothing consent, contradicting the app's
granular-consent posture. Multi-family membership is achieved with multiple invitations — epic
#115's reconciliation already dedups a person who joins several families into one account/Person
(two memberships on one Person, which is correct).

*Deferred convenience:* an invite form that multi-selects families and **fans out into N
independent invitation rows** (each with its own relationship picker and its own accept). Same data
model, less clicking. Deferred, not part of "one invitation = one family."

## 6. Member removal (build now)

Today there is **no way for a steward to remove a member.** The `memberships.status` enum has
`paused`/`ended` and an `ended_at` column, but **nothing in the app ever sets them** — the only
`status='ended'` in the codebase is a test using raw SQL. Combined with "any member can invite" and
"membership *is* the content front door," the steward currently has neither a brake nor a reverse
gear over family composition. That is a governance/consent hole, not a convenience gap.

**Build `remove-member`:** a core `endMembership` (steward-only) that sets `status='ended'` +
`ended_at`. `memberships` is the *revocable* link (mutable status, unlike the append-only consent
ledger), so this is a simple status update. It composes with §2's orthogonality:

- Ending a membership revokes **access only**.
- The person's **authored stories stay theirs**.
- Their **kinship edge stays in the tree** — a removed member can remain a tree node (kinship ≠
  membership).

## 7. What we are NOT doing

- **No backfill / suggested placement** for the 7 existing orphans. Too much work for a one-off;
  they simply appear in the to-be-placed queue and the owner will exercise the new placement flow
  on them. (Reference of what's there: Emily = invite "Daughter" [direct-primitive],
  Pookie = invite "Sister" [needs bridge], and Blake/Brent/Brooke/Grant/Kelly = join-requests with
  no relationship signal at all.)
- **No steward approval-before-send gate** now. It is a per-family policy toggle
  (`require_invite_approval`, default off) most families won't want. Safe to defer **because
  remove-member is the backstop** — a bad invite can be undone. Revisit if a family asks.
- **No new kinship edge types.** (§2.)

## 8. Schema / contract deltas

| Area | Change | Notes |
|---|---|---|
| `invitations` | structured, machine-readable relationship field | replaces reliance on free-text `relationship_label`; feeds the accept-time edge write |
| accept path | create kinship edge + set invitee `sex` per §3 table | silent; inviter is actor; subject hide-veto + steward override still apply |
| kinship write | new "link existing member" capability alongside `addRelative` | `addRelative` currently only mints a new Person |
| tree renderer | render edge-less member nodes (unplaced tray) | Tree **and** List views |
| `memberships` | per-family "non-family" flag | powers "leave as non-family member" |
| `memberships` | `endMembership` (steward) sets `status='ended'` + `ended_at` | **no schema change** — status already exists |

## 9. Build sequence

**Now:**
1. Structured invite relationship picker + silent auto-place on accept (prevention — kills the
   recurrence).
2. `remove-member` (governance backstop that makes the approval-gate deferral safe).
3. Placement UX: unplaced members in Tree + List, "link existing member" capability,
   "leave as non-family member" flag.

**Deferred (explicit):**
- Multi-family invite fan-out convenience.
- Steward approval-before-send gate.
- Any suggested/backfill placement for existing orphans.

## 10. Regression coverage to write with the build

- Accept an invite with each picker value → asserts the correct edge + sex; `Other` asserts none.
- A member with a membership but no kinship edge is **listed** (Tree + List) and is **placeable**
  via link-existing.
- `endMembership` revokes access but leaves the person's stories and their tree node intact.
- The prod incident as a fixture: invite "Son" → member appears in the Family tab without a manual
  DB write.
