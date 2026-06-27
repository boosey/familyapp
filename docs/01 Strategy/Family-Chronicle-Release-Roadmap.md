# Release Roadmap — Phased Sequencing

*Companion to the North Star Vision, Personas, Journey Map, Engagement Engine, and Consent & Estate Framework. This turns the north star into buildable releases. It is the one piece the vision explicitly deferred ("release sequencing — collaborative phased roadmap work to be done in a future session"). Strategy: **wedge-first, risk-retiring** — ship the sharpest wedge fastest to validate the core loop, then layer enrichment, engagement, and ethics-gated features in dependency order.*

---

## How to read this roadmap

**Phases are ordered by dependency and risk, not by calendar.** Because this will be built with AI coding agents (Claude Code, Codex, Gemini), raw implementation time is heavily compressed and unpredictable — a phase that would historically take a quarter might take days. So weeks and months are the wrong unit. The right unit is: *what must be true before the next phase is buildable, and what risk does each phase retire?* A phase is "done" when its exit criteria are met, not when a date arrives.

**Each phase is framed by:**  
- **Goal** — the one thing this phase proves or unlocks  
- **Scope** — what's in (and explicitly what's out)  
- **Build vs. buy** — where to integrate third parties vs. build in-house  
- **Risk retired** — the assumption this phase de-risks  
- **Exit criteria** — how you know it's done and the next phase can start

**The wedge-first logic.** The vision says elder storytelling is "Mode One — the first mode built and the primary entry point." It's the sharpest wedge: irreplaceable stories with a real deadline, the clearest emotional hook, and the richest single source of narrative to seed the chronicle. So the roadmap drives a thin but complete version of that to working software first, then widens.

**A note on competitive timing.** The vision warns the AI voice-first memoir space is "filling rapidly" and the window to claim the chronicle/multi-mode framing "is not indefinite." This argues for getting a real, voice-first elder-capture product into real families *early* — even thin — rather than perfecting the full institution in private. The compounding moat (enrichment, perpetual chronicle, multi-generation) is built in later phases, but the wedge has to land before the window narrows.

---

## Phase 0 — The Spine (foundation that everything reads from)

**Goal.** Establish the single data spine the whole system depends on, so no later phase has to retrofit it. The vision is explicit that all modes share "*one* data spine, identity model, and synthesis engine."

**Scope.** The core entry model (a "story" with original media, transcript, synthesized text, timeline placement, entities, audience tier, and consent status); a basic family/identity model; user accounts for the *younger* generation only (the elder never logs in); and the consent ledger and per-story permission model in their minimal form — because the Consent & Estate Framework establishes these as the foundation nothing sensitive ships without.

**Build vs. buy.** *Build* the entry model and identity graph — this is the core IP. *Buy* auth, storage, and database infrastructure (standard cloud primitives). Defer the hard multi-family identity question (see Open Questions) — build a clean single-family model now with the seams to extend later.

**Risk retired.** That you'd otherwise build capture and enrichment on a data model that can't hold a perpetual, multi-audience, consented chronicle — the most expensive thing to retrofit.

**Exit criteria.** A story can exist in the system with media, text, an audience tier, and a consent record; a family of users can be created; permissions are enforced. Nothing user-facing yet — this is the keel.

---

## Phase 1 — The Wedge: Elder Voice Capture (MVP)

**Goal.** Prove the core loop: an elder talks, with zero friction, and a younger family member receives a real story in the elder's actual voice. This is the minimum lovable product and the sharpest competitive wedge.

**Scope.** Mode 1 in its thinnest complete form: the AI interviewer running a gentle session; voice-first, zero-app entry for the elder (start with one channel — phone call or a single-tap link — not all of them); the oral-history question engine (open-ended, non-leading, one at a time, reminiscence-bump weighted, from the vision's base question sets); recording, transcription, and speech-to-story synthesis *with original voice preserved*; voice-only approval by the elder; and a basic family hub where the younger generation hears the result. Plus the answered-question loop (younger asks → routed into the elder's next session → answer returned), because the Journey Map shows that loop is the relay's core and the Engagement Engine names it the highest-leverage trigger.

**Out of scope (deliberately).** External-data enrichment, avatars, mysteries, ambient capture, multiple entry channels, the steward console. All later.

**Build vs. buy.** *Buy* transcription/speech-to-text (mature, commoditized) and telephony (a voice/phone API) — building these is wasted effort. *Buy* the LLM for synthesis and the interviewer. *Build* the interviewer's *behavior* — the oral-history technique, pacing, silence tolerance, session memory, and reminiscence weighting — because generic chatbot patterns are exactly what the vision says to avoid, and this craft is differentiating. *Build* the elder's zero-friction entry experience; it's the wedge's whole point.

**Risk retired.** The two riskiest assumptions in the entire product: (a) that elders will actually engage with an AI interviewer with dignity and without friction, and (b) that the resulting stories are good enough that younger family members care. If either fails, everything downstream is moot — so this phase exists to find out fast, with real families.

**Exit criteria.** A real elder (not the founder) completes multiple gentle sessions unassisted after setup; their family receives and is moved by the stories in the elder's voice; the asked-question loop closes end to end. You'd put your own grandmother on it.

---

## Phase 2 — Make It Land: The Payoff Surface & Light Engagement

**Goal.** Turn captured stories into something the younger generation returns to, and start the heartbeat so the chronicle doesn't go quiet after the first burst. Retain, don't just capture.

**Scope.** Mode 4 as a real explore surface (timeline, story feed, photo gallery, audio player with original voice — mobile-first); richer Mode 3 question-asking with suggested prompts so no one faces a blank box; and the cheapest, stickiest engagement triggers from the Engagement Engine's recommended first wave — the social loop (Group D) and the weekly "this week in family history" digest (A2), which run on the family's own warmth and existing content with no new data sources. Add photo upload so the family can enrich stories with images.

**Build vs. buy.** *Build* the explore surfaces and the trigger orchestration (the per-person cadence rules — this is product craft). *Buy* nothing major new; this phase leans on Phase 1's foundation.

**Risk retired.** That capture without a payoff surface and an engagement loop decays into the digital shoebox — the vision's central failure mode. This phase proves people come *back*.

**Exit criteria.** Families return between capture sessions (measurable re-engagement); the weekly digest is opened, not muted; younger members ask questions unprompted. The loop is self-feeding without the founder nudging.

---

## Phase 3 — The Moat: External-Data Enrichment

**Goal.** Build the defensible differentiation no one-year-book competitor has — fuse the family's own narration with external historical records. This is the unfair advantage the Engagement Engine's "discovery triggers" depend on.

**Scope.** Sequence integrations by the vision's "enrichment-per-effort" rule: start with free, high-coverage sources (FamilySearch, Chronicling America, the Ellis Island arrival records, U.S. census) plus user-linked Ancestry/MyHeritage accounts. Light up the record-match prompts ("here's the ship that brought your grandfather over in 1921"), day-in-history context cards, and contradiction/gap detection from the Engagement Engine's Group B. Place stories on a verified tree skeleton.

**Build vs. buy.** Mostly *integrate* (buy/partner) — these are external data providers reached via partnerships, APIs, or guided user-linked accounts, exactly as the vision describes. *Build* the matching and enrichment layer that turns a raw record into a gentle prompt or a context card. Treat **DNA as explicitly out of scope here** — the vision flags it as the most sensitive category (surprise kin, law-enforcement use, the 23andMe breach and bankruptcy); it's a later, strictly opt-in module.

**Risk retired.** That the product is just another AI memoir tool. Enrichment is what makes it a *chronicle* and what competitors filling the voice-memoir space can't easily replicate.

**Exit criteria.** A record match produces a real prompt that elicits a story the family didn't know to ask for; the timeline shows enriched context; gaps surface as gentle invitations. The moat is visibly working.

---

## Phase 4 — The Institution: Stewardship, Custody & Governance

**Goal.** Make the chronicle safe to grow and to inherit — the institutional layer that separates a perpetual chronicle from a memoir that dies in a drawer. This is also the gate that must precede avatars.

**Scope.** Mode 5: the steward console (membership, the legible permissions/access map, the consent ledger surfaced for review, gap/quality review); custody hand-off and successor naming; the "story will" / digital-estate instrument; time-gated release (release on an 18th birthday, open after death, seal for N years); and full AI disclosure across all artifacts. This is the Consent & Estate Framework's "governance, second" tier built out.

**Build vs. buy.** *Build* — this is bespoke product and the family's trust depends on it being legible, not bolted on. *Buy* durable backup/storage primitives; honestly answer the durability and data-portability questions the steward (Diane) will ask, including what happens to the archive if the company disappears.

**Risk retired.** That growth and longevity outrun governance — a privacy mistake, an orphaned archive, or an inability to answer "who holds the keys in eighty years?" Also retires the ethical precondition for Phase 5.

**Exit criteria.** A steward can govern membership and per-story visibility legibly; consents are auditable; a successor can be named and custody handed off; time-gated releases fire correctly. The chronicle could outlive its founder.

---

## Phase 5 — The Powerful, Dangerous Features: Avatars (gated)

**Goal.** Ship the most powerful capability — voice and conversational avatars — only now, behind the governance built in Phase 4. The vision and the Consent & Estate Framework both make this strictly conditional.

**Scope.** Voice avatars first (a synthesized voice answering in the relative's *real recorded words*), then optionally conversational video. Living-person avatars before posthumous ones — they're co-authored, consented in real time, and far safer to learn on. Every avatar passes the four-check consent gate (consent in the ledger → "their words only" enforced → mutual consent + family governance → disclosure + a retirement procedure). Built on the StoryFile retrieval model, never a generative ghost.

**Build vs. buy.** *Buy/partner* for voice synthesis and avatar rendering technology where mature. *Build* the consent enforcement, the "their words only" retrieval constraint, and the retirement procedures — the governance is the IP and the ethical line, and it cannot be outsourced.

**Risk retired.** This phase doesn't retire risk — it *introduces* the product's highest risk, which is precisely why it's last and gated. The earlier phases exist partly to make this one safe to attempt.

**Exit criteria.** An avatar can only be created and interacted with when every consent gate passes; "their words only" holds (no fabricated statements); retirement works; disclosure is visible. Ship to living-person co-authored cases first; treat posthumous as a further, deliberate step.

---

## Phase 6+ — The Widening (the rest of the north star)

Once the institution stands, the remaining vision modes and innovations layer on as the chronicle matures — none on the critical path to a defensible, lovable product, all valuable later:

- **Mode 2 (real-time / present-tense capture)** — 20-second drop-ins from the middle generation; deepens the bidirectional-time thesis.  
- **Mode 6 (ambient / passive capture)** — the smart-home "story corner"; opt-in, consent-gated.  
- **Live/synchronous AI-co-piloted family calls** (richer Mode 3).  
- **Mysteries, geolocation triggers, sensory prompts** (Engagement Engine Groups C) — deeper multi-player engagement.  
- **DNA module** — strictly opt-in, late, with deletion rights.  
- **Legacy & forward-time features** (time-capsules, auto-editions, documentaries) — Engagement Engine Group E.  
- **Heritage-language preservation, health-adjacent reminiscence mode, cross-family historical match** — the vision's further innovations.

---

## The dependency logic at a glance

Each phase makes the next *buildable* or *safe*:

- **Phase 0** gives everything a spine to read from.  
- **Phase 1** proves elders engage and stories matter — without which nothing else is worth building.  
- **Phase 2** proves people return — converting capture into retention.  
- **Phase 3** builds the moat — enrichment that needs Phase 0's data model and Phase 1's stories to enrich.  
- **Phase 4** makes it an institution — and is the ethical gate for what follows.  
- **Phase 5** ships the dangerous feature — only because Phase 4 made it safe.  
- **Phase 6+** widens into the full north star on a stable, trusted base.

The through-line matches the whole document set: start with what needs only the family and the calendar, add what needs data, then what needs time — and never let a powerful feature precede its guardrail.

---

## Two open questions the roadmap can't resolve alone

These are flagged in the vision and surface again here because they shape early phases:

1. **The multi-family identity/data model.** Does a person carry one archive through life, or belong to many family chronicles at once? Phase 0 builds a clean single-family model with extensible seams, but the real decision should be made consciously before the identity graph hardens. This is the recommended next working session.

2. **Where the wedge meets the business.** The wedge (Phase 1) earns the stories; the chronicle (Phases 3–4) earns the subscription. The Personas doc notes the buyer (Marcus) and the source (Elder) are different humans — pricing and packaging should be designed around that split, and it's worth deciding which phase introduces paid conversion.  
