# Tree changes — Slice C: cross-person editing

**Date:** 2026-07-14
**Status:** Design — approved decisions folded in
**Depends on:** Slice A (the details sheet exists; this slice adds its edit mode).
**Surface:** new ADR, a DB migration, `packages/core` write path, `apps/web/app/hub/tree/*`.
**Heaviest slice** — it introduces the first authorized write path for editing a person who is **not
the viewer**. Needs an ADR before code.

## What it delivers

- `#4` — double-click details sheet gains an **Edit** affordance, shown only when the viewer is
  permitted to edit that person.
- `#5` — double-clicking an **unknown** card (unidentified / nameless) opens the details sheet
  **directly in edit mode** (when permitted), so naming a placeholder is one gesture.

## The authorization policy (approved)

A viewer MAY edit a person's identity fields when **any** of:

- **Self** — `viewer.personId === person.personId`. (Already exists as the `/hub/profile` self-edit.)
- **Creator** — the viewer created the person record. **Requires new data** (see migration).
- **Steward** — the viewer is the steward of a family the person is an active member of.
- **Deceased → any active family member** — if `person.lifeStatus === "deceased"`, any viewer sharing
  an **active** family membership with the person may edit. (Family collaboratively maintains
  ancestors' records; matches the memory/legacy domain, FamilySearch-style.)

Explicitly NOT permitted: editing a **living, non-self** person unless you are the **steward** or the
**creator**. (A living person owns their own record.)

This predicate lives in **one** core function so the UI gate and the write guard can never diverge:

```
canEditPerson(db, ctx, personId): Promise<{ allowed: boolean; reason: "self"|"creator"|"steward"|"deceased-family"|null }>
```

The server action re-checks it (never trust the client's Edit button); the UI calls it (or a cheaper
projected flag) to decide whether to show Edit.

## Migration: `createdByPersonId`

- Add `persons.createdByPersonId` — nullable FK to `persons.id`, the person who created this record.
- Set it going forward in `addRelative` (`kinship-write.ts`) and anywhere a Person is minted
  (invitee creation, mention creation). Existing rows stay null (dev has no production data —
  "single schema, no backfills"; if this ships to Neon it is additive/nullable, safe).
- Emit BOTH artifacts via `db:generate` (snapshot + a new `NNNN_*` migration). Invariant changes, if
  any, hand-carried per the repo's migration discipline.
- `createdByPersonId` is **immutable provenance** (like `origin`) — never edited after insert.

## Core write path (new)

`updatePersonIdentityAsEditor(db, ctx, personId, patch)` in a new/existing `person-identity.ts`
surface:

- `patch` covers the editable identity fields: `displayName`, `birthDate`/`birthYear`, `deathDate`/
  `deathYear`, `sex`, `lifeStatus` (and `spokenName` only for self — a spoken name is a narrator
  concept; non-self editors don't set it).
- **Guard:** calls `canEditPerson` first; throws `NotAuthorized` if not allowed. This is the single
  write choke point for non-self edits.
- Reuses the field-level setters already in `person-identity.ts` (`updatePersonDisplayName`, etc.)
  under the umbrella guard, so validation stays in one place.
- `#5`: editing an **unidentified** person that gains a name flips `identified` true (naming a
  placeholder promotes it from anonymous bridge to a real card). Confirm the `identified` transition
  rules against ADR-0016/0017 (origin `"mention"` bridge → identified once named).

## ADR (write before code)

New ADR — **"Who may edit a Person record"** — recording the policy above, the `createdByPersonId`
provenance field, the single `canEditPerson` predicate + choke-point write path, and the
deceased→family-member carve-out with its risk (any member can rewrite a deceased relative; accepted
for shared family history, steward can still correct). Link from `docs/DECISIONS.md`.

## UI (details sheet edit mode)

- `person-details.tsx` gains an **Edit** button when `canEditPerson` says yes (projected as an
  `editable` flag from the server, or checked via a light action — do NOT ship the predicate logic to
  the client).
- Edit mode: inline form for name / dates / sex / lifeStatus; Save calls
  `updatePersonIdentityAsEditor`; on success, refetch the anchor subtree (reuse Slice A's
  `refetchAnchor`) so the card updates (name, sex color, ring, dates).
- `#5`: an unknown card opens the sheet with edit mode already active (skip the read-only view) when
  `editable`; otherwise read-only with no Edit.
- Steward edits of a deceased/other person may warrant a light audit note — check whether the kinship
  governance ledger or a new note is expected; **default: no new ledger in Slice C** (identity edits
  are not kinship assertions), record as a follow-up if governance wants provenance.

## Files touched

- `docs/adr/ADR-00NN-person-record-editing.md` — **new**; link from `docs/DECISIONS.md`.
- `packages/db/src/schema.ts` — `persons.createdByPersonId`; `db:generate` → snapshot + migration.
- `packages/db/drizzle/*` — generated snapshot + `NNNN_*` migration.
- `packages/core/src/person-identity.ts` (or a new module) — `canEditPerson`,
  `updatePersonIdentityAsEditor`.
- `packages/core/src/kinship-write.ts` — set `createdByPersonId` on person creation.
- `packages/core/src/index.ts` — re-exports.
- `apps/web/app/hub/tree/person-details.tsx` — edit mode + gate.
- `apps/web/app/hub/tree/tree-canvas.tsx` — pass `editable`/refetch; `#5` open-in-edit for unknowns.
- `apps/web/app/_copy/hub.ts` — edit-mode copy, field labels, errors.

## Testing (auth is the risk surface — test it hard)

- `canEditPerson` truth table: self ✓; creator ✓; steward ✓; deceased + active-family-member ✓;
  living non-self non-steward non-creator ✗; non-member ✗; anonymous ✗.
- Write guard rejects a disallowed editor even if the action is called directly (not just UI-hidden).
- `createdByPersonId` is set on `addRelative` and is immutable.
- `#5`: naming an unidentified person flips `identified` and it renders as a real card.
- Regression companions for each bug found in review.
