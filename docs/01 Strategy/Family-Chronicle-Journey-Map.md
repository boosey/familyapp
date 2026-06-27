# Journey Map — The Life of One Story

*Companion to the North Star Vision and the Personas doc. This traces a single story — "How Eleanor got her first paycheck and what she spent it on" — as it moves through all four people and all four modes. The point of the map is to show that no one person makes a story; the chronicle works as a relay. A question from one person becomes a memory from another, becomes a shared moment, becomes a governed, durable entry that a descendant will one day inherit.*

*Cast (from the Personas doc): **Sofia**, 16, granddaughter (Mode 4). **Eleanor**, 81, narrator (Mode 1). **Marcus**, 52, son and organizer (Mode 3). **Diane**, 58, daughter and steward (Mode 5).*

---

## The spine: one story, eight phases

The story doesn't start with the elder. It starts with a question — which is the whole design insight. Curiosity from the young is what pulls the memory out of the old.

| # | Phase | Whose hands | Mode |  
|---|---|---|---|  
| 1 | The spark — a question is born | Sofia | 4 → 3 |  
| 2 | The routing — question waits for the right moment | System | — |  
| 3 | The telling — the memory is given | Eleanor | 1 |  
| 4 | The synthesis — raw voice becomes an entry | System | — |  
| 5 | The approval — the author signs off | Eleanor | 1 |  
| 6 | The sharing — the story reaches the family | Marcus | 3 |  
| 7 | The governance — the entry is made safe & durable | Diane | 5 |  
| 8 | The inheritance — a descendant receives it | Future kin | 4 |

The loop closes and reopens: the inheritance in phase 8 is just a spark (phase 1) for the next generation.

---

## Phase 1 — The spark (Sofia, Mode 4 → 3)

**What happens.** Sofia is half-watching the family thread when her dad shares a two-minute clip of Grandma. Something in it makes her curious — what was Grandma's life like at *her* age? She opens the family hub, and instead of a blank "ask a question" box, she sees a suggested prompt: "Sofia, your grandmother would love to know what *you* want to ask her." She taps and personalizes one: "What was the first thing you ever bought with your own money?"

**Sofia's emotional arc.** Mild curiosity → a flicker of real interest → the small satisfaction of sending something that matters.

**Touchpoints.** Family thread / share link; mobile family hub; suggested-question prompt; async question submission.

**System behavior.** Lowers the barrier to participation (no blank box); captures the question and tags it to Eleanor's queue; notes who asked, so the answer can be returned to Sofia personally.

**Risk if done wrong.** A blank box, a clunky form, or a "homework" feel and Sofia never asks — the spark dies and the elder is never prompted.

**Design opportunity.** Treat the grandchild's question as the primary ignition source for the whole system, not a nice-to-have. Suggested prompts are load-bearing.

---

## Phase 2 — The routing (System)

**What happens.** Sofia's question doesn't ping Eleanor immediately — that would be an interruption and a demand. It's held and woven into Eleanor's next *gentle session* at her chosen time, sequenced appropriately (light and warm, not dropped cold into a heavy topic).

**Emotional arc.** No human is active here — and that's the point. The system absorbs the coordination so neither Sofia nor Eleanor feels the machinery.

**Touchpoints.** Question queue; session scheduler; sequencing logic.

**System behavior.** Buffers questions; orders them by rapport and emotional weight; arrives "prepared" with names and context so the question can be framed warmly ("Your granddaughter Sofia was wondering…").

**Risk if done wrong.** Immediate, raw delivery feels like a demand; poor sequencing drops a hard question before rapport exists.

**Design opportunity.** The routing layer is where the product's emotional intelligence lives. It converts a teenager's idle curiosity into a gentle, well-timed invitation.

---

## Phase 3 — The telling (Eleanor, Mode 1)

**What happens.** Tuesday, 10am, the time Eleanor chose. A warm, familiar voice greets her by name and, after a little easy conversation, says: "Your granddaughter Sofia was wondering — what was the first thing you ever bought with your own money?" Eleanor laughs, remembers a dress, a payday, a specific summer, and just talks for a few minutes. The system waits through her pauses and never rushes her.

**Eleanor's emotional arc.** Warmth at being greeted → delight that *Sofia* asked → the quiet pleasure of being genuinely listened to → a sense of mattering.

**Touchpoints.** Inbound call or home device; warm consistent persona; voice-first, no login; generous pacing.

**System behavior.** AI leads and carries all cognitive load; open-ended, non-leading question; tolerates silence; records original voice; can gently follow a rich thread or wind down if she tires.

**Risk if done wrong.** Any friction (a login, a menu, a rushed interruption) and Eleanor disengages — the story is lost at the source.

**Design opportunity.** Naming the asker ("Sofia was wondering") is the move that closes the loop emotionally and gives Eleanor a reason to return. The grandchild's name is the hook.

---

## Phase 4 — The synthesis (System)

**What happens.** The raw recording is transcribed, lightly cleaned, placed on the timeline at the right year, tagged with entities (the town, the job, the dress), and rendered into a short readable story — while the original audio is preserved and foregrounded. The system also notices the year she mentioned and cross-checks it against records, surfacing a possible "day in history" card for that summer.

**Emotional arc.** Invisible to humans — but this is where a three-minute ramble becomes something Sofia will actually want to receive.

**Touchpoints.** Transcription; narrative generation; timeline/entity placement; record enrichment.

**System behavior.** Speech-to-story while preserving the real voice; auto-placement; contradiction/gap detection; optional enrichment from external sources.

**Risk if done wrong.** Over-polished prose that drifts from Eleanor's real words breaks authenticity; the recording must always sit alongside the synthesized text.

**Design opportunity.** Enrichment turns a personal memory into a historically grounded entry ("here's the front page from that summer") — added value no shoebox can offer.

---

## Phase 5 — The approval (Eleanor, Mode 1)

**What happens.** Before anyone sees it, Eleanor reviews — by voice. The system reads back the short story; she corrects one detail ("it was 1958, not 1959") and approves it for the family. She remains the author and owner.

**Eleanor's emotional arc.** A flash of control → pride in getting it right → the dignity of having authored, not just supplied, her own story.

**Touchpoints.** Voice review and edit; approval gate; privacy choice (family / branch / private).

**System behavior.** Nothing is shared until she approves; voice-only correction; her chosen visibility is recorded into the consent layer.

**Risk if done wrong.** Auto-publishing without approval violates her authorship and trust — a single such breach can end her participation.

**Design opportunity.** The approval step is a dignity feature, not a bottleneck. It's also the first entry into Diane's consent ledger (phase 7).

---

## Phase 6 — The sharing (Marcus, Mode 3)

**What happens.** Sunday evening, Marcus sees the new approved story waiting. He listens to two minutes in his mother's actual voice, smiles, and shares it to the family thread. He adds a follow-up question of his own — "Ask her what a week's pay even bought back then" — keeping the engine warm.

**Marcus's emotional arc.** Relief that it's working without nagging → warmth hearing his mother → the satisfaction of momentum → motivation to ask the next thing.

**Touchpoints.** Progress view; audio player; one-tap share; async follow-up question.

**System behavior.** Surfaces new captures; makes sharing frictionless; routes his new question back into phase 2; logs near-zero ongoing effort on his part.

**Risk if done wrong.** If Marcus has to do heavy lifting, momentum dies and Eleanor stops being prompted; if sharing is clumsy, the story never reaches Sofia and the loop never closes.

**Design opportunity.** Marcus is the relay's amplifier. His share is what delivers the answer back to Sofia — closing the loop that started in phase 1 — and his follow-up is what opens the next one.

---

## Phase 7 — The governance (Diane, Mode 5)

**What happens.** The story enters the chronicle's permanent record. Diane, reviewing periodically, confirms its visibility (whole family — nothing sensitive here), sees it logged in the consent ledger with Eleanor's approval and chosen audience, and notes it's safely backed up and durable. When a new cousin marries in later, this story is among the shared family entries they'll be granted — but a different, private chapter won't be.

**Diane's emotional arc.** Quiet diligence → reassurance that consent was honored → confidence the archive is safe and will outlast them.

**Touchpoints.** Steward view; consent ledger; permissions; backup/durability indicators; succession settings.

**System behavior.** Records provenance and consent; enforces visibility; preserves durably; supports custody hand-off so the entry survives the steward.

**Risk if done wrong.** Weak governance turns the growing archive into a digital shoebox — preserved but abandoned, or leaked to the wrong relative.

**Design opportunity.** Governance is what makes this an *institution* rather than a memoir. The same invisible step that protects one paycheck story is what lets the chronicle outlive everyone in the room.

---

## Phase 8 — The inheritance (Future kin, Mode 4)

**What happens.** Years from now — maybe at Sofia's own daughter's 16th birthday — a descendant browses the chronicle, hears Eleanor's actual voice telling the paycheck story, sees it on the timeline beside the front page from that summer, and feels connected to a great-grandmother she never met. And because the system invites it, she taps a suggested question of her own.

**Emotional arc.** Surprise → connection → belonging → curiosity (which is phase 1, again).

**Touchpoints.** Explore surface (timeline / map / voice player); preserved original audio; suggested question.

**System behavior.** Delivers the durable, enriched, consented entry; preserves the real voice; reignites the loop with a new spark.

**Risk if done wrong.** If durability, voice preservation, or custody failed anywhere upstream, the inheritance never arrives — the story dies in a dead account.

**Design opportunity.** This phase is the entire payoff and the proof of the thesis: time runs in two directions. A small Tuesday memory, captured today, becomes a treasured past — and immediately seeds the next generation's curiosity.

---

## What the map reveals (design takeaways)

**Curiosity is the ignition, not the conclusion.** The story begins with Sofia's question, not Eleanor's prompt. The grandchild's wonder pulls the memory out of the elder. Build the question-asking surface as a primary input, not a passive feature.

**The system carries the coordination so humans only feel the warmth.** Phases 2 and 4 are invisible by design. The routing and synthesis layers absorb all the friction so neither the 81-year-old nor the 16-year-old ever touches machinery.

**Closing the loop emotionally is what sustains the system.** Naming the asker to Eleanor ("Sofia was wondering"), and returning the answer to Sofia, is what makes both want to come back. The relay only stays warm if each handoff lands personally.

**Every persona is load-bearing on a different axis.** Sofia ignites, Eleanor sources, Marcus amplifies, Diane preserves. Remove any one and the relay breaks: no spark, no story; no share, no loop; no governance, no longevity.

**The endpoint is a new beginning.** The inheritance is just the next spark. A journey map that looks linear is actually a loop — which is exactly what a *perpetual* chronicle requires.  
