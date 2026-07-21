# Vision and Mission

## Mission

Help families **record, keep, and share** the stories of the people they love — **in their own voice** — so descendants can still hear the laugh, the pause, and the exact way it was told.

## North star (updated)

Build a **perpetual family chronicle**: a living, private institution that holds a family's stories, photos, and relationships across generations — not a one-time rescue project that ends when a book ships.

### What changed from early strategy docs

Early documents (`docs/01 Strategy/Family-Chronicle-Vision.md`) over-rotated on:

1. **Elders as the product** — narrators are important, but the hub serves the whole family
2. **Phone calls as primary entry** — the product is a **web app**; link sessions are the account-free exception
3. **"Mode 1 only" framing** — capture is the wedge, but album, tree, questions, and browse are first-class today

The mission did not change. The **center of gravity** moved from "elder rescue via telephony" to **family storykeeping with elder-accessible design**.

## Core beliefs

1. **Stories belong to the family, not the platform.** Private by default. Nothing sold. No training third-party ad or AI models on user content.

2. **Voice matters.** The recording is the emotional artifact; prose is an authored companion, not a replacement.

3. **The narrator is the author.** They approve what is shared. Consent is append-only and auditable.

4. **One kind of user.** A Person has an Account. Narrating and asking are **actions**, not account types.

5. **Dignity over cleverness.** Warm, plainspoken, never condescending. Never guilt-driven. Never grief-bot vibes.

6. **Mission over UX fashion.** Accessibility and low cognitive load are requirements because they serve the mission — not because "elders are the only users."

## The chronicle thesis (still true)

- **One spine, many surfaces.** Stories, photos, asks, and kinship share one data model and authorization layer.
- **Time runs two ways.** Recover the past *and* capture a present that becomes someone's treasured past.
- **Roles rotate.** Today's grandchild becomes tomorrow's narrator and eventually a steward.
- **Artifacts are snapshots.** A story feed today; a book or documentary cut later — all from one growing corpus.

## Interaction modes (conceptual map)

The original vision named six modes. Today's shipped product maps roughly as follows:

| Mode (vision) | Shipped today | Notes |
|---------------|---------------|-------|
| Guided narration | **Tell**, **Answer**, **About-you intake**, link-session capture | Web-first; controlled interviewer loop in capture paths |
| Real-time capture | **Tell a story** (self-initiated) | Mobile-friendly; 20-second drop-in ambition partially met |
| Interviewer / curious relative | **Ask**, **Your asks**, follow-up questions on stories | Async question relay is live |
| Explorer / audience | **Stories** (feed/timeline/search), **Story detail**, **Person pages** | "Ask the archive" Q&A deferred |
| Archivist / steward | **Family settings**, **Requests**, kinship governance, album moderation | No succession / story-will yet |
| Ambient / passive | — | Not built |

Modes are **lenses on one chronicle**, not separate products.

## Design principles (product)

1. **Voice-first, never voice-only.** Every voice step has a typed fallback.
2. **Finish ≠ Share.** Composing ends at Finish; sharing is a separate consent act (ADR-0014).
3. **Detect-and-offer, never silent rewrite.** Polish, ask suggestions, and finish-checks require confirmation.
4. **Their words only.** Follow-ups deepen; they do not invent. Future avatar work is retrieval-only.
5. **Explore is read-only.** Browse surfaces add no new authorization — they project what the front door already allows (ADR-0011).

## Ethical lines (non-negotiable)

- No generative fabrication of new statements in a deceased person's voice
- AI-assisted content labeled when it materially changes presentation
- Posthumous interactive features require explicit governance (not shipped)
- Kinship edges never drive story authorization — membership + consent do

## Success looks like

A real family uses Tell Me Again for months:

- Grandmother answers questions from her phone browser without creating a password
- Adult children ask specific questions and hear answers in her voice
- Teenagers browse stories and photos and ask follow-ups
- The steward manages who belongs and what inappropriate content is removed
- Nothing leaks outside the family's chosen audience
