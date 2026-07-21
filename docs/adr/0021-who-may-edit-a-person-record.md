# ADR-0021 — Who may edit a Person record

Status: Accepted (2026-07-15)

Builds on **ADR-0016** (kinship is a steward-governed per-family tree) and the existing self-edit
surface (`/hub/profile` → `updatePersonIdentity`). Full design: `docs/99-pruned/superpowers/specs/2026-07-14-tree-slice-c-person-editing-design.md`.

## Context

Slice A of the tree redesign gave every card a read-only **details sheet** (double-click). Slice C
adds an **Edit** affordance to that sheet — the first time the app lets a viewer write identity fields
(`displayName`, birth/death dates, `sex`, `lifeStatus`) of a Person who is **not themselves**.

Two facts frame the policy:

- **Identity is on the OPEN schema, not the content front door.** `persons` rows are reachable
  directly (see `person-identity.ts`); they are *not* Story/Media content, so ADR-0007's single
  front door does not apply. Nothing structural stops a cross-person write today — which is exactly
  why the policy must live in one auditable predicate, not be scattered across call sites.
- **Kinship is not authorization (ADR-0016).** Being *depicted* in a tree grants nothing. Editing a
  person's record is a stronger act than asserting an edge about them, so it needs its own gate,
  distinct from `addRelative`'s "attachable in this family" rule.

The domain is collaborative family memory: ancestors' records are maintained by their living
descendants (FamilySearch/Ancestry both allow this), while a *living* person owns their own record.

## Decision

**A viewer MAY edit a Person's identity fields when ANY of:**

1. **Self** — `viewer === person.id`. (The pre-existing `/hub/profile` self-edit.)
2. **Creator** — the viewer created the person record. Requires a new immutable provenance field,
   `persons.createdByPersonId` (see below).
3. **Steward** — the viewer is the `stewardPersonId` of a family the person holds an **active**
   membership in.
4. **Deceased → any active family member** — if `person.lifeStatus === "deceased"`, any viewer who
   shares an **active** family membership with the person may edit.

**Explicitly NOT permitted:** editing a **living, non-self** person unless you are the **steward** or
the **creator**. A living person owns their own record. An anonymous/non-member viewer may never edit.

`spokenName` is a **narrator concept** (what the interviewer speaks aloud) and is editable **only by
self** — a non-self editor never sets it.

### One predicate, one write choke point

The policy lives in a **single** core function so the UI gate and the write guard can never diverge:

```
canEditPerson(db, ctx, personId):
  Promise<{ allowed: boolean; reason: "self" | "creator" | "steward" | "deceased-family" | null }>
```

- The UI does **not** ship this logic to the client. The server projects a boolean `editable` flag
  (via a light server action, `personEditabilityAction`) that the details sheet consumes to decide
  whether to show **Edit**.
- The write path `updatePersonIdentityAsEditor(db, ctx, personId, patch)` calls `canEditPerson`
  **first** and throws `AuthorizationError` when not allowed. It is the single non-self identity-edit
  choke point; a disallowed editor is rejected even when the action is called directly (not merely
  UI-hidden). It reuses the field-level setters already in `person-identity.ts`, so validation stays
  in one place.

`reason` is a **precedence order**, first match wins: self → creator → steward → deceased-family. It
is informational (the server only reads `allowed`); the order is stable so tests and any future audit
note key off a deterministic winner.

### `createdByPersonId` — immutable provenance

- New column `persons.createdByPersonId`: **nullable** FK to `persons.id`, the Person who created the
  record. Immutable after insert (like `origin`) — the edit path never touches it.
- Set going forward on **every Person mint**: `addRelative`'s relative + every anonymous bridge/ghost
  it mints (`kinship-write.ts`), and the invitee mint (`invitations.ts`). It is the acting viewer's
  `personId`.
- Existing rows stay **null** ("single schema, no backfills" — dev has no production data). Shipping
  to Neon is additive/nullable → safe. A null creator simply means the Creator arm can't match for
  that legacy row (self/steward/deceased-family still can).

### Deceased → family-member carve-out (accepted risk)

Any active member of a family the deceased belongs to may rewrite that deceased relative's record.
**Risk:** one member can overwrite another's contribution to a shared ancestor (name spelling, dates).
**Accepted** because shared family history is inherently collaborative and the alternative
(steward-only) makes a large tree unmaintainable. Mitigation: the **steward can still correct** any
edit, and `updatedAt` moves on every write. A living person is never exposed to this — the carve-out
is gated on `lifeStatus === "deceased"`.

### No new ledger in Slice C

Identity edits are **not kinship assertions**, so they do not append to the kinship ledger, and
`persons` is not append-only. If governance later wants per-field provenance/audit for cross-person
identity edits (who changed grandma's birth year, when), that is a **follow-up** — a `person_edits`
audit ledger parallel to the kinship one — deliberately out of scope here to keep the audited surface
minimal.

## Considered options

- **Steward-only cross-person editing:** rejected — makes a deep ancestor tree unmaintainable; the
  people with the memories (descendants) are usually not the steward.
- **Any family member may edit any member (living included):** rejected — a living person owns their
  own record; letting relatives rewrite a *living* person's identity is an over-share the self/creator/
  steward arms already cover for the legitimate cases.
- **Inferring "creator" from the kinship ledger's `actorPersonId`:** rejected — the actor of an *edge*
  is not the creator of the *person* (a bridge is minted by whoever added the grandchild, edges get
  re-asserted, reconciliation redirects them). A dedicated immutable `createdByPersonId` is
  unambiguous.

## Consequences

- One new nullable column; one new migration (additive, safe for Neon).
- `person-identity.ts` gains the `canEditPerson` predicate + `updatePersonIdentityAsEditor` choke
  point; both re-exported from `@chronicle/core`.
- Every Person mint now records its creator; the truth table for `canEditPerson` is the risk surface
  and is tested exhaustively (self / creator / steward / deceased-family / living-non-self ✗ /
  non-member ✗ / anonymous ✗), plus a direct-call write-guard rejection.
- A future cross-family identity edit under ADR-0019 (a person depicted in a family the editor can't
  see) is unaffected: `canEditPerson` only ever grants via active memberships the editor shares with
  the subject, so it discloses nothing new.
