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
- **Narrator** — the (age-neutral) role of a Person whose stories are being captured/answered
  (membership role `narrator`). Says nothing about the Person's age, generation, or which access
  mechanism they use; a narrator may hold an Account or arrive only through a Link Session.

## Joining a family (the new flows)
- **Invitation** — an account-creating link a member sends to someone (possibly unknown to the
  system). Accepting it creates/links the invitee's Account and an active Membership. **Distinct
  from a Link Session** — that is a login-free capture identity with no Account.
- **Link session** — a login-free, token-based capture mechanism: a long unguessable token *is* the
  identity for the session, no Account needed. Named for *how* you arrive (a link); it assumes
  nothing about who the Person is or whether they want an account. An access mechanism/preference,
  not an identity. Remains the path for the genuinely no-account channel (telephony).
- **Magic link** — a texted deep link whose token, when the resolved Person *has* an Account, is a
  **passwordless login to that account** (not an account-less Link Session) and routes straight to a
  specific question's answer page. Time-boxed and reusable within its window. The link is the
  password (a bearer credential for the account), accepted deliberately for elderly narrators.
- **Discoverable family** — a Family whose steward has opted into being found by search. Default is
  private (not discoverable).
- **Family search** — finding a *discoverable* family by name, description, steward name, or member
  names. Returns family name + steward name only; never members or stories.
- **Join request** — a discovered family is not joined, only *requested*. The steward approves
  (→ Membership) or declines. The only discovery path to membership.
- **Onboarding** — the first-sign-on flow for an Account: confirm identity →
  date of birth (the one required step) → choose to enter the hub or tell a first story. Gated by
  `Person.onboardedAt`. Link sessions never onboard (they carry no Account).

## Narrative & consent (existing — unchanged)
- **Story** — the unit of narrative, owned by one Person, surfaced into Families per its
  **audience tier** (`private` | `branch` | `family` | `public`). Audio recording is canonical;
  transcript/prose are derived and regenerable.
- **Draft** — a recorded-but-not-yet-approved Story: durable audio + row, **no transcript/prose**
  (the pipeline is deferred until approval, so no tokens are spent on a take that may be discarded).
  A draft is the narrator's *approve-later* work — it is never auto-deleted. It is deletable (audio
  blob + row) only because it was never consented; once approved, its audio is immutable forever
  (audit trail + improvement data).
- **Discard / re-record** — the two events that delete a draft's audio (event-driven cleanup; no
  time-based sweep). Re-record supersedes the prior take.
- **Consent ledger** — append-only record of approvals/revocations. Nothing is shared until the
  author approves; revocation is a new superseding row, never an edit.
- **Ask** — a family member's question for a narrator; becomes the narrator's next prompt and, once
  answered + approved, the family's notification.
