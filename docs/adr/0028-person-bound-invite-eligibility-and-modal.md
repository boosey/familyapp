# ADR-0028 — Person-bound Invite: membership-gap eligibility, bound create, modal-over-navigate

Status: Accepted (2026-07-22)

Extends **ADR-0006** (provisional Person on cold invite), **ADR-0023** (invite acceptance places kin;
membership ≠ tree placement; List/Tree IA split), **ADR-0027** (List browse vs Tree place/govern).
Parent chain: issues #329–#335.

## Context

Slice D treated Invite affordance as largely Account-centric: a Person with an `accountId` projected
as `accepted`, which hid Invite even when that Person was not a Member of another Family the viewer
belongs to. The grilled Zach → Carney scenario (browse Boudreaux → open Zach → invite into Carney)
requires the opposite: eligibility tracks **Membership gaps**, not Account presence.

Separately, inviting someone already on List or Tree must not mint a second Person (**Dedup-on-invite**
extended beyond cold mention matching). And the UX must not yank the viewer to the Invite tab via
deeplink — details stay in place and Invite opens as a modal.

## Decision

### Membership-gap Invite eligibility

**Invite eligibility** means: the Person is identified and living, and the viewer has at least one
Family where that Person does **not** hold an active Membership. Account presence alone does **not**
hide Invite. Pending invite status remains scoped to the Family being invited into (the chosen
target), not "pending in some other Family."

Family chips in the Invite UI hide Families where the invitee already has active Membership;
auto-select when exactly one eligible Family remains, otherwise leave no seed.

### Person-bound Invitation create

An Invitation started from an existing List/Tree Person binds to that Person on create
(**person-bound Invitation** / **Dedup-on-invite**). Create refuses if the invitee is already an
active Member of the target Family. When an Account-holder accepts, add Membership (and relationship
per ADR-0023) without minting a second identity. Cold Invite-tab creates may still mint a provisional
Person (ADR-0006); person-bound create does not.

### Modal-over-navigate

Invite from List details, Tree details, or Tree kebab opens one **in-place modal** (shared form with
the cold Invite tab). After send, Person details stay open on the current view. The Tree deeplink
that navigated to the Invite tab for this path is retired. The Invite tab remains for cold invites
of people not already on List/Tree.

Contacts (email/phone) may prefill **in the modal only**; they are not a permanent Person-details
surface in this decision. Steward approval-before-send, multi-family fan-out in one send, and
in-app-only delivery stay out of scope.

## Considered options

- **Keep Account → `accepted` as the Invite hide rule** — rejected. Blocks the cross-family
  Account-holder case the product requires.
- **Mint a new provisional Person when inviting from List/Tree** — rejected. Violates Dedup-on-invite;
  creates a second identity for the same human.
- **Deeplink / tab-navigate to Invite for person-bound sends** — rejected. Breaks List/Tree context;
  modal-over-navigate keeps details open and reuses one form shell.

## Consequences

- Core projection / helpers use membership-gap Invite eligibility (ADR-0028). Account presence is
  never its own `inviteStatus` — #335 retired the transitional Account-centric `accepted` value;
  affordance is solely `invitable` / `pending` / `not-applicable`.
- `createInvitation` gains a person-bound path; accept path must join Account-holders without a
  second Person.
- Web List and Tree share one Invite modal; List still omits edge governance (ADR-0023 / ADR-0027).
- Glossary terms (**Invite eligibility**, **Person-bound Invitation**, expanded **Dedup-on-invite**,
  **Family tab List**) stay aligned with this ADR.

## Amendment (#335, 2026-07-22)

Retired the compatibility `accepted` inviteStatus union member. After consumers migrated to
membership-gap eligibility (#332–#334), Account presence no longer appears as a distinct Invite
status — a Person with no membership gap is simply `not-applicable`.
