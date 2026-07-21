# Tree changes — Slice D: invite affordance

**Date:** 2026-07-14
**Status:** Design — approved decisions folded in
**Depends on:** Slice A (details sheet + kebab). Independent of B and C.
**Surface:** `packages/core` (tree projection + a light invite-status read),
`apps/web/app/hub/tree/*`, wiring the **existing** invite flow.

## Goal (`#6`)

Add an **Invite** affordance for a person who has not been invited yet, from the tree. The invite
flow itself already exists (`createInvitation`, `acceptInvitation`, `/hub/invite`,
`reapUnacceptedInvitees`); Slice D only surfaces an entry point and the eligibility signal.

## Eligibility predicate

Show **Invite** only when the person is invitable:

- `identified === true` (a real person, not an anonymous bridge), AND
- `lifeStatus === "living"`, AND
- has **no account** (`accountId == null` — not already a real user), AND
- has **no pending/accepted invitation** (no `invitations` row for them, or the latest is
  revoked/expired), AND
- the viewer is entitled to invite into the relevant family (reuse the existing invite-permission gate
  from `/hub/invite`).

## Data plumbing: invite status on the tree node

`TreeNode` currently carries no invite signal. Add a projected field:

```
inviteStatus: "invitable" | "pending" | "accepted" | "not-applicable"
```

computed in `resolveKinshipTree` (`kinship-repository.ts`) from `persons.accountId`, `persons.origin`,
`persons.lifeStatus`, `persons.identified`, and the `invitations` table:

- `accepted` — has an `accountId` (already a user).
- `pending` — has a live (`pending`) invitation.
- `invitable` — identified, living, no account, no live invitation.
- `not-applicable` — bridge/deceased/otherwise not invitable.

Kinship metadata only — this **does not widen the content front door** (it reads person/invitation
rows, not Story/Media). Keep the projection query id-cheap; join invitations by `inviteePersonId` for
the in-window nodes only.

## UI (details sheet + kebab)

- **Details sheet** (`person-details.tsx`): an **Invite** button when `inviteStatus === "invitable"`;
  a muted "Invitation pending" note when `pending`. Clicking Invite opens the existing invite flow
  (modal or navigate to `/hub/invite` pre-targeted at this person/family).
- **Kebab** (`kebab-menu.tsx`): an **Invite…** item under the same eligibility, placed with the
  people-actions group (before or alongside Add…). Both entry points call one handler.
- No card badge (decision: keep the card clean — affordance lives in the sheet + kebab).

## Files touched

- `packages/core/src/kinship-repository.ts` — compute `inviteStatus` in `resolveKinshipTree`;
  add the field to `TreeNode`.
- `packages/core/src/index.ts` — `TreeNode` type already re-exported; no new content path.
- `packages/core/src/invitations.ts` — reuse; maybe a `personInviteStatus(db, personId)` helper if a
  per-person read is cleaner than a join in the projection.
- `apps/web/app/hub/tree/person-details.tsx` — Invite button / pending note.
- `apps/web/app/hub/tree/kebab-menu.tsx` — Invite… item (eligibility-gated).
- `apps/web/app/hub/tree/tree-canvas.tsx` — pass `inviteStatus`; open invite flow.
- `apps/web/app/_copy/hub.ts` — invite copy (button, pending note).

## Testing

- `inviteStatus` projection truth table: account-holder → `accepted`; live invitation → `pending`;
  identified living no-account no-invitation → `invitable`; bridge/deceased → `not-applicable`.
- The Invite affordance shows only for `invitable`; pending shows the muted note; others show nothing.
- Inviting from the tree reaches the existing `createInvitation` path (no new invite logic).
- Front-door: `architecture.test.ts` green (invite status is person/invitation metadata, not content).
