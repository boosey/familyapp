# CONTEXT — Glossary

The canonical vocabulary of Family Chronicle. Terms only; no implementation. When code or
conversation uses a word that conflicts with a definition here, the conflict is a bug in one of them.

## Identity & membership
- **Person** — the permanent, singular human; owner of everything expressive. There is one kind of
  user. A Person normally has an Account, but two states precede one: a **provisional Person** (a
  pending invitee, created so questions can be queued for them before they accept) and the
  telephony exception.
- **Account** — the login attached to a Person. Holds only the auth provider's user id + basic
  profile; never a password. Provisioned just-in-time when a Person accepts an invitation
  (ADR-0005); a provisional invitee and a telephony Person have none.
- **Provisional Person** — a `persons` row created at invitation time for someone who has not yet
  accepted (Option A / ADR-0006). Lets Asks and other references attach to a real anchor before
  acceptance; acceptance links an Account to the *same* Person. An invitee who never joins leaves a
  provisional Person cleaned up by a housekeeping pass (never expressive, never surfaced).
- **Family (Chronicle)** — a container a family's stories are *surfaced into*. Owns nothing
  expressive. Has a **steward**.
- **Steward** — the Person who governs a Family: approves who joins, holds succession (seam), and
  **may delete any content in the Family** (member stories, photos, captions) as moderation of
  inappropriate material. The creator of a Family is its first steward.
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
- **Invitation** — a system-delivered link a member sends to someone (possibly unknown to the
  system). The inviter supplies the invitee's contact; the system delivers the invite over an
  **Outbound channel** and records that contact as the invitee's notification channel. Accepting it
  creates/links the invitee's Account and an active Membership. (The invitation is thus the moment
  the system learns how to reach a Person — the precondition for ever notifying them.)
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
  blob + row) only because it was never consented; once approved, its audio can no longer be mutated
  or detached — it stays the canonical source for as long as the Story exists, and is removed only
  when the Story itself is deleted (ADR-0008). Deletion is always available (owner erasure, steward
  moderation); the guarantee is against *silent swap*, not against deletion.
- **Discard / re-record** — the two events that delete a draft's audio (event-driven cleanup; no
  time-based sweep). Re-record supersedes the prior take.
- **Consent ledger** — append-only record of approvals/revocations. Nothing is shared until the
  author approves; revocation is a new superseding row, never an edit.
- **Ask** — a question one Person submits for another Person who is narrating; becomes the
  narrator's next prompt and, once answered + approved, the family's notification. Any user can
  submit an Ask; asking and narrating are not mutually exclusive. The target may be a **provisional
  Person** (a pending invitee): the Ask queues and surfaces to them only *after* they onboard, as a
  warm "your family is waiting" hook — never delivered pre-acceptance. The floor is the Invitation:
  no asking a total stranger (ADR-0006). Like a Story, an Ask has a **kind** (`voice` | `text`). A
  voice Ask is recorded and transcribed; the transcript is the asker's to edit, with only light
  **disfluency cleaning** applied. The question reaches the narrator in the asker's own words, framed
  warmly by the interviewer persona but never reworded. This mirrors the *answer* side: a Story's
  "prose" render is likewise disfluency-cleaning that preserves the speaker's actual words, never a
  literary rewrite (`render-story.ts`). For both question and answer the **first version is always in
  the person's own words**; a fuller **AI re-render is opt-in** (a planned icon-button action near the
  edit field), not the default — and deferred. **Text is always available** (durable record + fallback).
- **Asker-avatar** — the asker's actual recording (voice now; face/video later) delivered to the
  teller in-session, so the narrator hears the real relative ask rather than a synthetic voice. The
  asker opts in per Ask (`deliveredToTeller`); if they don't, the teller gets the text. The
  recording is a permanent Media linked to the Ask (consent scope deferred; until designed it
  travels asker→teller only, not family-wide).

## Engagement & notification
- **Notification** — an outbound message the system pushes to a Person to pull them back into the
  chronicle between sessions (e.g. "a new story was shared," "someone asked you a question"). The
  counterpart to the pull-only hub. Every notification names a **channel** (`email` | `sms` |
  `voice`) reflecting how that Person is reachable; a Person's reachable channels differ by role
  (a member reads email; an elder narrator may only be reachable by text or phone).
- **Outbound channel** — the seam through which a Notification is delivered. A vendor seam like the
  others (interface + mock in our code; the provider SDK only in an adapter). Distinct from the
  **Magic link**, which is a *credential inside* a notification, not the delivery mechanism itself.
- **Digest** — a batched, scheduled Notification summarizing recent chronicle activity, softened and
  aggregated ("Grandma shared about Sunday dinner and 3 other stories"). Reaches the whole family —
  every member, not only the asker — to spur engagement, but is built **per recipient through the
  audited authorization read**, so each person's digest contains only what they may see, and never
  their own activity. Contrast with an event Notification, which fires on a single triggering event.
- **Notification stream** — a category of Notification a Person sets a frequency for independently
  (`every item` | `daily digest` | `weekly digest`). Three streams: **questions-for-me** (default
  daily), **answers-to-my-asks** (default every item — it is the payoff), **family activity**
  (default weekly). One event may feed two streams (an answered Ask rewards the asker *and* enters
  everyone else's family-activity digest), de-duplicated so no one is told twice.
- **Social loop** — the retention pattern where one Person's contribution (a shared Story, an Ask)
  generates a Notification to the rest of the family, whose response (listening, asking back)
  generates the next. The family's own warmth is the fuel; no external data source is required.

## Story imagery
- **Family album** — a Family-scoped shared pool of photos. A photo in the album is visible to and
  usable by any Person sharing an **active membership** with its contributor (the same rule the
  `family` audience tier already uses). Modeled like a shared Apple/Google album: contributed, not
  owned. NOT "anywhere in the system" — a photo never escapes the family it was contributed into.
  **Every** uploaded photo lands in the album regardless of path (direct add, during story creation,
  during Ask creation); there is no photo stored outside the album. Being in the album *is* the
  contributor's consent for the family to see it — so there is no "private photo".
- **Contributor** — the Person who uploaded a photo. A photo has a contributor, **not an owner**:
  uploading IS consent for any family member to view or use it, and no further consent is asked to
  reuse it on any story within that family. (This is the one asset that departs from the CONTEXT
  rule "a Person owns everything expressive" — a Family-album photo is a *shared* asset with a
  contributor, not sole-owned expressive content.) Deletable by the contributor, by the family
  **steward**, and by anyone the contributor grants that permission. Deletion removes it everywhere
  it is used (any story cover/gallery loses it).
- **Story image** — a picture that **accompanies** a Story to illustrate the words (decoration
  alongside the narrative). A Story may have *several*. This is distinct from a **Subject photo**,
  which the text is *about*. Every Story image carries a **provenance** that fixes what kind of
  thing it is — never blurred:
  - **Family photo** — an authentic photograph from the family album (uploaded by any member; later,
    a linked Apple/Google library). It depicts something real; an authenticity claim is being made.
  - **Illustration** — an external, openly-licensed image chosen only to *represent* the story's
    subject (e.g. a stock photo of red beans and rice). Nobody in the family owns it; it makes **no**
    authenticity claim and the surface must label it as illustrative, never as a family photo.
- **Cover** — the single Story image shown on the story card in a feed. The others appear when the
  story is opened. Every Story image is either the cover or a non-cover member of the story's set.
- **Suggested image** — a candidate surfaced to the narrator based on the story's content, family-
  album sources preferred over external ones. A suggestion is not attached until a narrator picks it.
- **Subject photo** — the photo a piece of text is *about* (as opposed to a **Story image**, which
  merely accompanies). A **Caption** is a short Story about one Subject photo; an **Ask** may target
  one or more Subject photos ("tell me about these"). The subject relationship is separate from the
  accompaniment relationship — the same photo can play either role on different items.
- **Caption** — a short **Story** whose subject is a photo, not a separate lightweight artifact.
  Same pipeline as any Story (author, approval, consent); it is simply *short* and photo-bound.
  Several UXs lead to the one artifact: the photo's contributor adding a line, or a Person answering
  an **Ask** that targets a photo. Because it is a Story, a caption authored by a non-owner is that
  person's testimony and follows the normal approval/consent path before the family sees it.

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
