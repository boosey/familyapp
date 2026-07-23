# Users, Roles, and Personas

## One kind of user

There is **one user type: a Person** with an Account (except the narrow link-session case for account-free capture).

| Term | Meaning |
|------|---------|
| **Person** | The permanent human; owns stories, recordings, consent |
| **Account** | Login credential attached to a Person |
| **Membership** | Person ↔ Family link with role and status |
| **Narrating / Asking** | Actions in a session — not personas or account tiers |

Early personas (Eleanor, Marcus, Sofia, Diane) remain useful **design lenses**, but they are not product boundaries.

## Roles (what someone does)

These rotate across a lifetime. The same Person may narrate today and ask tomorrow.

### Storyteller (narrator)

Records memories — by voice or text — in response to a question, a photo, or their own initiative.

**Often** an elder who prefers not to "use an app," but **not always.** A 40-year-old parent telling a story about their childhood is equally a narrator.

**Needs:**
- Low friction (magic link or simple hub flow)
- Large controls, patient pacing, typed fallback
- Author control: review, edit, choose audience
- Dignity: never feel tested or processed

**Entry paths today:**
- Signed-in: `/hub/tell`, `/hub/answer/[askId]`
- Account-free: `/s/[token]` (personal link from inviter)

### Asker

Submits a question for another family member to answer.

**Often** adult child or curious grandchild.

**Needs:**
- Dead-simple question form (optional photos)
- Proof the question was received and answered
- Hear the answer in the narrator's voice

**Surface:** `/hub?tab=ask`, follow-up from story detail

### Explorer (audience)

Browses, listens, searches, favorites stories and photos.

**Anyone in the family** with membership — including the narrator on a good day.

**Needs:**
- Feed, timeline, search — not walls of text
- Audio playback, photos, person pages
- Easy on-ramp to ask their own question

**Surface:** Stories tab, story detail, person pages, album

### Steward

Governs a Family: approves join requests, edits family settings, moderates content, affirms/denies kinship edges.

**Often** the family organizer; not necessarily the oldest member.

**Needs:**
- Requests queue, family edit, kinship governance
- Confidence the archive is safe and durable

**Surface:** `/hub?tab=requests`, `/families/[id]/edit`, tree governance controls

### Initiator / organizer

The person who **starts** the family's chronicle — creates the family, invites members, nudges storytellers.

Usually overlaps with steward or adult child. This is the **buyer and engagement engine** in commercial terms.

## Revised personas (not age-locked)

### Maya — the storyteller who won't learn software

**72, widowed, rich stories, low tech patience.**

Happy to talk; hates passwords and menus. Uses the **personal link** (`/s/[token]`) or a magic link that drops her into the hub answer flow. Needs voice-first UI, large type, and the ability to stop anytime.

*Design implication:* link-session and magic-link paths must stay excellent. Every required login on the narrator path is a bug.

### James — the organizer who gets it started

**48, working parent, comfortable with technology.**

Notices how much of the family's story lives in just one or two people, and that nobody's writing it down. Sets up the family, invites Mom, sends specific questions, shares answers to siblings. Needs visible progress without nagging.

*Design implication:* ask relay, draft reminders, one-tap sharing, "your asks" status.

### Sofia — the curious grandchild

**16, digital native, short attention span.**

Wants surprise and connection — voice, photos, short stories. Will not read a memoir manuscript. Asks her own questions when hooked.

*Design implication:* mobile-first hub, audio-forward cards, person pages, suggested questions.

### Diane — the long-view steward

**55, keeps the family together administratively.**

Approves cousins joining, corrects tree mistakes, removes inappropriate content. Wants governance without becoming IT support.

*Design implication:* steward tools, kinship affirm/deny, family settings, erasure paths.

## Accessibility posture

Elder-friendly design is **default quality**, not a separate "simple mode":

- 18px UI floor, 22px story floor (Kindred tokens)
- Voice button with typed fallback on every capture surface
- Text size + palette preferences (Heirloom / Archive / Hearth)
- Reduce motion option
- Mobile bottom navigation (ADR-0025)

A teenager benefits from the same clarity. The difference is **which entry path** someone uses, not a different product.

## Multi-family reality

A Person may belong to **multiple Families** (e.g., birth family and in-laws). Content is targeted per story and per photo — not duplicated. Family filter chips on browse surfaces narrow the view (ADR-0021).

## Who is not a user (yet)

- **Anonymous public** — `public` audience tier exists in schema; no external read surface
- **GEDCOM importers** — background job designed; not shipped
