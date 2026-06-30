# CONTEXT — Glossary

The canonical vocabulary of Family Chronicle. Terms only; no implementation. When code or
conversation uses a word that conflicts with a definition here, the conflict is a bug in one of them.

## Identity & membership
- **Person** — the permanent, singular human; owner of everything expressive. Every Person has an
  Account; there is one kind of user.
- **Account** — the login attached to a Person. Holds only the auth provider's user id + basic
  profile; never a password. Every web user has one; telephony is the narrow exception.
- **Family (Chronicle)** — a container a family's stories are *surfaced into*. Owns nothing
  expressive. Has a **steward**.
- **Steward** — the Person who governs a Family: approves who joins, holds succession (seam). The
  creator of a Family is its first steward.
- **Membership** — the plural, revocable link between a Person and a Family. Carries a DB role
  (`narrator` | `member` | `steward`) and status (`active` | `paused` | `ended`). At most one
  *active* membership per (Person, Family). Granted by the family — never seized. The DB role
  `narrator` marks whose stories are the *primary capture focus* of this Membership — a structural
  fact about the family relationship, not a statement about the Person's account type or identity.
- **Narrating / Asking** — actions, not user types. There is one kind of user. Any Person can
  narrate (record and share their stories) and any Person can ask (submit questions for another
  Person who is narrating). The same Person may narrate in one session and ask in another. *Narrator*
  and *asker* are shorthand for the role a Person is playing in a specific interaction — not a
  persona, not an account category, not a permanent identity.

## Joining a family (the new flows)
- **Invitation** — a link a member sends to someone (possibly unknown to the system). Accepting it
  creates/links the invitee's Account and an active Membership.
- **Magic link** — a texted or emailed deep link whose token is a **passwordless login to the
  Person's existing Account**, routing straight to a specific question's answer page. Time-boxed and
  reusable within its window. The link is the password (a bearer credential), accepted deliberately
  so a Person never has to type a password. This is the primary low-friction entry for all users,
  including elderly narrators who should never see a login screen.
- **Link session** — a token-based session for the genuinely account-free case: telephony (inbound
  phone calls). The long unguessable token maps to a Person and a Family context; it is a narrow
  seam for channels where Account-based login is impossible, not a general-purpose anonymous-access
  mechanism. Web narrators use a Magic link (auto-login to their Account), not a link session.
- **Discoverable family** — a Family whose steward has opted into being found by search. Default is
  private (not discoverable).
- **Family search** — finding a *discoverable* family by name, description, steward name, or member
  names. Returns family name + steward name only; never members or stories.
- **Join request** — a discovered family is not joined, only *requested*. The steward approves
  (→ Membership) or declines. The only discovery path to membership.
- **Onboarding** — the first-sign-on flow for an Account: confirm identity → preferred spoken name
  (required for the interviewer) → date of birth (required) → choose to enter the hub or tell a
  first story. Gated by `Person.onboardedAt`.

## Narrative & consent
- **Story** — the unit of narrative, owned by one Person, surfaced into Families per its
  **audience tier** (`private` | `branch` | `family` | `public`). Stories have a `kind`:
  `voice` (audio recording is canonical; transcript/prose are derived and regenerable) or
  `text` (typed response is canonical; no recording). A user may switch to keyboard at any
  time; the resulting story is a text story, not a failed voice story.
- **Draft** — a recorded-but-not-yet-approved Story: durable audio + row, **no transcript/prose**
  (the pipeline is deferred until approval, so no tokens are spent on a take that may be discarded).
  A draft is the narrator's *approve-later* work — it is never auto-deleted. It is deletable (audio
  blob + row) only because it was never consented; once approved, its audio is immutable forever
  (audit trail + improvement data).
- **Discard / re-record** — the two events that delete a draft's audio (event-driven cleanup; no
  time-based sweep). Re-record supersedes the prior take.
- **Consent ledger** — append-only record of approvals/revocations. Nothing is shared until the
  author approves; revocation is a new superseding row, never an edit.
- **Ask** — a question one Person submits for another Person who is narrating; becomes the
  narrator's next prompt and, once answered + approved, the family's notification. Any user can
  submit an Ask; asking and narrating are not mutually exclusive.

## Interviewer
- **Biographical anchors** — a named-field record on Person with known keys: `hometown`,
  `siblingContext`, `currentLocation`, `occupationSummary`, `hasChildren`, `hasGrandchildren`.
  Populated by the intake pass (direct answers) or by LLM extraction from approved stories (never
  overwrites a directly-answered field). Used by the interviewer to personalize phrasing and
  skip redundant questions.
- **Intake** — a structured 6-question first pass run at the start of a Person's first narrating
  sessions, before the open story bank. Collects biographical anchors. Resumable across sessions
  (stops where the user left off). Complete when all 6 anchor fields are populated. The hub shows
  a reminder until complete or until story extraction has filled the gaps.
- **Deeplink session** — a session initiated from a notification that carries a specific `askId`.
  The interviewer routes to that Ask first, then continues into the normal session flow. Always
  priority over warm callbacks and intake.
- **Warm callback** — the interviewer's opening on turn 0 when prior stories exist: a brief,
  concrete reference to something the user said in a previous session. Makes sessions feel like
  a continuing relationship. Fires after any deeplink ask is handled; intake resumes from turn 1.
