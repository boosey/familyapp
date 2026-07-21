# The Engagement Engine — The Chronicle's Heartbeat

*Companion to the North Star Vision, Personas, and Journey Map. This document designs the system that keeps a perpetual chronicle alive between big moments. The vision is blunt about why this matters: rescue has built-in urgency, but a perpetual chronicle "must manufacture its own reasons to return across decades or it becomes the digital shoebox — preserved but dead." The engagement engine is not garnish. It is the heartbeat.*

---

## Why this is the hard problem

The vision states it directly in the Caveats: *"The chronicle's hardest problem is longevity, not capture."* Recording stories is the easy part. Keeping a multi-decade institution alive — getting people to come back, season after season, year after year, generation after generation — is harder than any single interview.

Every other family-storytelling product sidesteps this by being finite. StoryWorth runs for a year and ships a book. Remento is book-centric. They end, so they never have to solve retention. This product's entire differentiation — the perpetual chronicle — is also its hardest engineering and design challenge. The engagement engine is where that challenge is won or lost.

A useful frame: the journey map showed how *one* story completes a loop (spark → telling → sharing → governance → inheritance → new spark). The engagement engine is what fires that loop again and again without anyone deciding to sit down and "work on the family history." It supplies the sparks.

---

## The core retention loop

Every durable trigger follows the same four-beat shape. If a trigger doesn't complete this loop, it's noise.

**1. A signal occurs.** Something in the world or the chronicle becomes relevant — a date, a record discovered, a location, a gap in the story, a contribution from a relative.

**2. The system surfaces it to the right person, gently.** Not a blast to everyone. The signal is routed to the persona best positioned to act on it, framed warmly, at a tolerable cadence.

**3. The person acts — low effort.** They answer one question, tap one share, ask one thing, confirm one detail. The action must be small enough to do in the gap between other things.

**4. The action produces a visible reward and feeds the next signal.** The story grows, a loop closes, someone is delighted — and that growth generates the next signal (a new gap, a new share, a new question). The loop is self-feeding.

The genius of a *family* system is that the reward for one person becomes the signal for another. Eleanor's new story (reward) is Sofia's notification (signal). Sofia's question (action) is Eleanor's next prompt (signal). The engine runs on the family's own social warmth, not on manufactured gamification.

---

## The trigger catalog

Triggers are grouped by what fires them. For each: **what fires it**, **who it targets**, **the persona served**, **cadence**, and **the anti-annoyance rule** that keeps it from becoming spam. (Personas referenced: Eleanor — narrator; Marcus — initiator; Sofia — grandchild; Diane — steward.)

### Group A — Time-based triggers (the calendar is always running)

These exist because dates arrive whether or not anyone's thinking about the chronicle. The calendar is a free, infinite signal source.

**A1 · Anniversary prompts.** *Fires on:* a wedding anniversary, a birthday, a death anniversary, the date of a major life event already in the chronicle. *Targets:* whoever the date belongs to, or close kin. *Serves:* Eleanor (a gentle session prompt — "Sixty years ago this week you married Frank; tell me about that morning") and Sofia (a card to view or contribute). *Cadence:* event-driven, naturally rare per person. *Anti-annoyance rule:* never auto-fire a death anniversary as celebratory; treat grief dates with a softer, opt-in touch.

**A2 · "This week in family history" digest.** *Fires on:* a weekly cron that scans the chronicle for entries, photos, and records tied to this calendar week across all years. *Targets:* the whole family, opt-in. *Serves:* Sofia and the broader audience (Mode 4) — a calm, browsable feed, not a demand. *Cadence:* weekly, one digest, bundled. *Anti-annoyance rule:* one digest, never per-item pings; if a week is empty, stay silent rather than manufacture filler.

**A3 · Seasonal & holiday prompts.** *Fires on:* recurring holidays and seasons the family observes. *Targets:* narrators for recollection ("What did Christmas look like when you were Sofia's age?"), the middle generation for present capture ("What does our Thanksgiving look like this year?"). *Serves:* Eleanor and Marcus (Mode 2). *Cadence:* a handful per year. *Anti-annoyance rule:* learn which holidays the family actually marks; don't prompt holidays they don't observe.

**A4 · Reminiscence-bump sensory prompts.** *Fires on:* scheduled delivery of music, imagery, or references from a narrator's ages ~10–30 (the memory-rich window). *Targets:* the narrator. *Serves:* Eleanor (Mode 1). *Cadence:* woven into sessions, not a separate notification stream. *Anti-annoyance rule:* these belong inside gentle sessions, not as push notifications; they're a question technique, not an alert.

### Group B — Discovery-based triggers (the archive finds things)

These are the product's unfair advantage. No shoebox can do this. The system is actively *working* between sessions.

**B1 · Record-match prompts.** *Fires on:* an external-data match — a ship manifest, a census line, a newspaper mention, a yearbook photo. *Targets:* the relevant narrator, or the relative who'd know. *Serves:* Eleanor (Mode 1, record-triggered prompt — "Here's the ship that brought your grandfather over in 1921; did he ever talk about the crossing?"). *Cadence:* as discoveries surface; can be queued so they don't bunch. *Anti-annoyance rule:* verify match confidence before surfacing; a wrong "we found your ancestor" erodes trust fast.

**B2 · Contradiction & gap detection.** *Fires on:* the system noticing a conflict (record says 1923, Grandma said 1925) or a hole (no one has explained why the family left Sicily). *Targets:* the person who can resolve it, plus the steward for awareness. *Serves:* Diane (Mode 5 review) and whoever holds the answer. *Cadence:* surfaced gently, batched into a review, never alarmist. *Anti-annoyance rule:* frame as curiosity and invitation, never as "you have errors"; the narrator must never feel corrected or caught out.

**B3 · "Day in history" context cards.** *Fires on:* placing a story on the timeline and matching it to world/local events of that day. *Targets:* viewers of that story. *Serves:* Sofia and audience (Mode 4) — enrichment that makes a memory feel historically real. *Cadence:* passive; attached to stories, pulled not pushed. *Anti-annoyance rule:* keep it relevant and local; generic "this is what was happening in the world" is filler.

### Group C — Mystery & quest triggers (curiosity as a renewable resource)

The vision calls these out specifically: open family mysteries are "the heartbeat," not garnish. They work because an unanswered question is psychologically *open* — it pulls people back.

**C1 · Collaborative family mysteries.** *Fires on:* an unresolved question worth solving — "Who is the man in this photo?" "What happened to great-uncle Sal?" *Targets:* the whole family as a shared quest, with DNA hints and crowd-sourced answers. *Serves:* every persona; this is the engine's most powerful multi-player mode. *Cadence:* a few live at a time; new ones seeded as old ones resolve. *Anti-annoyance rule:* always keep at least one *solvable* mystery active; an all-dead-ends board is discouraging.

**C2 · Gap-as-invitation.** *Fires on:* B2's gaps, reframed as open quests rather than review items. *Targets:* the family member most likely to know. *Serves:* turns Diane's quality review into Sofia's and Marcus's curiosity. *Cadence:* steady trickle. *Anti-annoyance rule:* one open invitation at a time per person; don't present a wall of holes.

**C3 · Geolocation memory triggers.** *Fires on:* a family member visiting (or street-viewing) an old home, school, or hometown. *Targets:* the narrator who lived there, or the relative standing there now. *Serves:* Eleanor (Mode 1) and Marcus/Sofia in the moment ("You're near the house Grandma grew up in — want to ask her about it?"). *Cadence:* rare and location-driven, therefore high-signal. *Anti-annoyance rule:* opt-in location use only; never feel surveillant.

### Group D — Social triggers (the family is the engine)

These run on the family's own warmth. They're the cheapest and stickiest because the system isn't manufacturing a reason — a real human created one.

**D1 · Question-asked → answered loop.** *Fires on:* a relative submitting a question (Sofia → Eleanor) and, later, the answer being ready. *Targets:* asker gets notified when answered; teller gets prompted with who asked. *Serves:* the whole relay (this is the journey map's core loop). *Cadence:* event-driven by real curiosity. *Anti-annoyance rule:* always name the asker to the teller and return the answer to the asker; an unclosed loop kills future asking.

**D2 · New-contribution notifications.** *Fires on:* any approved new story, photo, or correction entering the chronicle. *Targets:* family members who'd care, by relevance. *Serves:* Marcus and Sofia (Mode 4). *Cadence:* bundled, not per-item. *Anti-annoyance rule:* digest by default; let people opt into real-time only if they want it.

**D3 · Milestone & membership events.** *Fires on:* a birth, a marriage-in, a reconnection, a new member joining. *Targets:* steward to admit/permission; family to welcome. *Serves:* Diane (Mode 5) and the whole family. *Cadence:* life-event rare. *Anti-annoyance rule:* route admin to Diane, celebration to everyone; don't make the whole family do paperwork.

**D4 · Nudge-the-narrator (initiator-driven).** *Fires on:* Marcus choosing to gently encourage a session, or the system suggesting he might. *Targets:* Eleanor, softly, via the warm persona — never as pressure. *Serves:* Marcus (Mode 3) as the engagement engine. *Cadence:* initiator-controlled. *Anti-annoyance rule:* the narrator must never feel nagged; nudges arrive as the system's warm invitation, not "Marcus is waiting on you."

### Group E — Legacy & forward-time triggers (time runs both directions)

These are unique to a perpetual chronicle. They create engagement by reaching into the future.

**E1 · Time-capsule releases.** *Fires on:* a future date set by a contributor — a message released on a grandchild's 18th birthday or wedding. *Targets:* the recipient, on the date; the contributor gets the satisfaction of setting it. *Serves:* every persona across time. *Cadence:* set once, fires once, far later. *Anti-annoyance rule:* honor the date and consent exactly; releases are sacred and must never misfire.

**E2 · Present-tense capture nudges (Mode 2).** *Fires on:* light prompts to the middle generation to record the ordinary now ("What does an ordinary Tuesday look like for our family this year?"). *Targets:* Marcus and his generation. *Serves:* Mode 2 — capturing the *raising*, not just the recollection. *Cadence:* gentle, infrequent, low-ceremony. *Anti-annoyance rule:* 20-second drop-ins, never a "project to finish"; mundane-by-design.

**E3 · Auto-generated editions & documentaries.** *Fires on:* enough new material accumulating to stitch a periodic edition (the family's annual) or a short documentary. *Targets:* the whole family as a reward moment. *Serves:* everyone (Mode 4). *Cadence:* periodic (annual) or event-driven (a wedding, a death). *Anti-annoyance rule:* a render, not a finish line; always framed as "here's where the chronicle is now," never "done."

---

## Orchestration — the rules that hold it together

A catalog of triggers is dangerous without a conductor. Twelve well-meaning notifications a week is how you train a family to mute the app. Three rules govern the whole engine:

**One voice, one cadence per person.** Each persona has a tolerated frequency. Eleanor gets gentle sessions at her chosen time and nothing else that feels like an alert. Sofia tolerates a lively weekly digest and answered-question pings. Diane wants batched review, not a stream. Marcus wants visible progress, lightly. The engine respects per-person budgets and never exceeds them — silence is always an option.

**Bundle, batch, and prefer pull over push.** Most triggers should accumulate into a digest the person chooses to open (pull), not interrupt them (push). The weekly digest, the contribution feed, and the gap review are all bundles. Push is reserved for genuinely time-sensitive, high-warmth moments (an answered question, a time-capsule release).

**Every trigger must complete the loop or be cut.** If a notification doesn't lead to a low-effort action that produces a visible reward and feeds the next signal, it's noise — and noise is how the whole engine gets muted. The test for any new trigger: *does it close a loop, and would the family thank us for it?*

A fourth, overriding rule: **the narrator's experience is sacrosanct.** No trigger may ever make Eleanor feel nagged, corrected, surveilled, or like she's "behind." Anything aimed at her passes through the warm persona as an invitation she's free to decline.

---

## How the engine maps to the personas

**Eleanor (narrator):** receives only gentle, warm, decline-able invitations — anniversary, record-match, sensory, and geolocation prompts, all routed through her session persona. Never a raw notification.

**Marcus (initiator):** the human half of the engine. Gets progress and contribution digests; controls nudges; is rewarded with visible momentum that keeps him — and through him, Eleanor — engaged.

**Sofia (grandchild):** the renewable curiosity supply. Fed the weekly digest, day-in-history cards, mysteries, and answered-question loops — the surfaces lively enough to keep a 16-year-old coming back, which keeps Eleanor prompted.

**Diane (steward):** receives batched gap/contradiction reviews, membership and milestone events, and oversees time-capsule and consent integrity. The engine gives her governance signals, not noise.

---

## Sequencing recommendation

Not all of this ships at once. Build the engine in the order that compounds:

**First — the social loop (Group D) and the weekly digest (A2).** These run on the family's own warmth and existing content; they're cheap and immediately sticky. The answered-question loop is the single highest-leverage trigger because it's the journey map's core relay.

**Second — discovery triggers (Group B).** Once external data is integrated, record-matches and gap detection become the unfair advantage no competitor can match.

**Third — mysteries and geolocation (Group C).** These deepen multi-player engagement once there's enough chronicle to mine.

**Fourth — legacy and forward-time (Group E).** Time-capsules and auto-editions are powerful but presuppose a mature, trusted, well-governed chronicle.

The through-line: start with triggers that need only the family and the calendar, then layer in the ones that need data, then the ones that need time. Each stage makes the next more valuable — which is the compounding the whole perpetual-chronicle thesis depends on.  
