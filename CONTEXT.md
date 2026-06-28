# CONTEXT — Glossary

The canonical vocabulary of Family Chronicle. Terms only; no implementation. When code or
conversation uses a word that conflicts with a definition here, the conflict is a bug in one of them.

## Identity & membership
- **Person** — the permanent, singular human; owner of everything expressive. Needs no login.
- **Account** — the optional, severable login attached to *some* Persons. Holds only the auth
  provider's user id + basic profile; never a password.
- **Family (Chronicle)** — a container a family's stories are *surfaced into*. Owns nothing
  expressive. Has a **steward**.
- **Steward** — the Person who governs a Family: approves who joins, holds succession (seam). The
  creator of a Family is its first steward.
- **Membership** — the plural, revocable link between a Person and a Family. Carries role
  (`narrator` | `member` | `steward`) and status (`active` | `paused` | `ended`). At most one
  *active* membership per (Person, Family). Granted by the family — never seized.

## Joining a family (the new flows)
- **Invitation** — an account-creating link a member sends to someone (possibly unknown to the
  system). Accepting it creates/links the invitee's Account and an active Membership. **Distinct
  from an Elder Session** — that is anonymous capture identity with no Account.
- **Discoverable family** — a Family whose steward has opted into being found by search. Default is
  private (not discoverable).
- **Family search** — finding a *discoverable* family by name, description, steward name, or member
  names. Returns family name + steward name only; never members or stories.
- **Join request** — a discovered family is not joined, only *requested*. The steward approves
  (→ Membership) or declines. The only discovery path to membership.
- **Onboarding** — the first-sign-on flow for a younger-generation Account: confirm identity →
  date of birth (the one required step) → choose to enter the hub or tell a first story. Gated by
  `Person.onboardedAt`. Elders never onboard.

## Narrative & consent (existing — unchanged)
- **Story** — the unit of narrative, owned by one Person, surfaced into Families per its
  **audience tier** (`private` | `branch` | `family` | `public`). Audio recording is canonical;
  transcript/prose are derived and regenerable.
- **Consent ledger** — append-only record of approvals/revocations. Nothing is shared until the
  author approves; revocation is a new superseding row, never an edit.
- **Ask** — a family member's question for an elder; becomes the elder's next prompt and, once
  answered + approved, the family's notification.
