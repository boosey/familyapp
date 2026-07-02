# ADR-0006 — You may ask a pending invitee; provisional Persons anchor the queued questions

Status: Accepted (2026-06-30)
Context: Phase 2 engagement-engine design (grill session). Deciding whether the asked-question
relay can start *before* the target has joined, and what data-model change that requires.

## Context

The Engagement Engine names the asked-question loop the single highest-leverage retention trigger.
A grandchild (Sofia) wants to ask her grandmother (Eleanor) a question. Today two facts block the
warm version of that:

- `createAsk` gates on **active co-membership** — Sofia cannot ask Eleanor until Eleanor is already
  an active member of a shared family.
- `asks.targetPersonId` is **`NOT NULL` → `persons.id`**, and an `invitations` row creates **no
  Person** (only `inviteeName`/`inviteeEmail` text; the Person + Account are provisioned just-in-time
  on acceptance, ADR-0005). So there is no anchor for an Ask to point at before acceptance.

The membership gate was first read as a *forcing function* (block the asker → pressure to onboard the
elder). On reflection that blocks the eager asker instead of harnessing them: the healthier design
lets curiosity accumulate as stored value that becomes the elder's onboarding hook ("your family
already has questions waiting for you").

## Decision

**An Ask may target a pending invitee, and inviting someone creates a provisional Person immediately
(Option A).**

- **Ask floor = the Invitation, not membership.** You may ask someone who has been invited to a
  family you belong to (pending or active); you may **not** ask a total stranger. `createAsk`'s
  boundary check moves from "active co-membership" to "target is an invitee (pending or active) of a
  family the asker is an active member of."
- **Provisional Person at invite time.** Inviting a new person inserts a `persons` row up front
  (unclaimed/provisional — no Account). Acceptance links an Account to that *same* Person (ADR-0005
  provisioning targets the existing row instead of creating one). `asks.targetPersonId` stays
  `NOT NULL`; every reference to an invitee has a real anchor.
- **No pre-acceptance delivery.** The only outreach a provisional Person receives is the invitation
  itself. Queued Asks surface **after** onboarding, framed as a warm "your family is waiting" hook —
  never pushed to them before they accept.

## Consequences

- **The relay can start before the elder joins**, and the accumulated questions become the carrot
  that pulls her in — turning the onboarding wall into an incentive.
- **`persons` gains a legitimately Account-less state** (the provisional invitee), joining the
  existing telephony exception. The glossary's "every Person has an Account" is loosened accordingly
  (see CONTEXT.md). A Person is still the permanent anchor of everything expressive; a provisional
  Person is simply one whose Account has not been linked yet.
- **Ghost rows.** An invitee who never accepts leaves a provisional Person. These are never
  expressive and never surfaced; a housekeeping pass reaps them (companion to the orphan-blob GC).
- **Acceptance is now a link, not a create.** ADR-0005's JIT provisioning must be adjusted to attach
  the Account to the pre-existing provisional Person rather than minting a new one — the uniqueness
  guard now also prevents double-linking a Person.
- Rejected: (a) **gate asks on active membership** — blocks the eager asker, wastes the highest-value
  curiosity signal; (b) **Option B, polymorphic ask target** (`targetPersonId` nullable +
  `targetInvitationId` + re-point on acceptance) — preserves "every Person has an Account" literally
  but leaks a dual-anchor into every future feature that references a person, fighting the model where
  Person is the single anchor.
