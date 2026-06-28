# Consent & Estate Framework — The Institutional Layer (Mode 5)

*Companion to the North Star Vision, Personas, Journey Map, and Engagement Engine. This is the governance backbone of the chronicle: who controls the archive, who may see what, what happens to a person's stories after they die, whether a posthumous avatar is ever permitted, and who holds the keys across generations. The vision is unambiguous: build this framework **before any avatar feature ships**. It is infrastructure, not an edge feature — and Diane, the steward, is the human who operates it.*

---

## Why this comes before the avatar

The vision treats avatars and "digital afterlife" features as "the most powerful AND most ethically dangerous capability." That's not caution for its own sake. The research backs it: studies of griefbots and deadbots find that posthumous AI replicas can interfere with healthy grieving, that public acceptance collapses without prior consent, and that the responsible-development consensus rests on consent, postmortem privacy, deadbot-retirement procedures, transparency about capabilities and risks, and the mutual consent of both the person whose data it is and the people who interact with it.

The practical consequence is a sequencing rule: **you cannot ethically build the powerful feature until the governance that constrains it exists.** An avatar without a consent ledger, a "their words only" guarantee, and a retirement procedure is exactly the product the ethics literature warns against. So this framework ships first. It also happens to be a trust feature for every other part of the product — Eleanor approves her own stories, Diane controls who sees them, and the family trusts the chronicle with its most private material precisely because this layer exists.

---

## Five foundational principles

These are the non-negotiables. Every feature in this document is an implementation of one or more of them.

**1. Their words only.** Following the StoryFile model, any avatar or "talk to a relative" experience is built strictly from the person's *real recordings* — a retrieval system that surfaces what they actually said, never a generative system that fabricates new statements in their voice. The chronicle does not put words in anyone's mouth, living or dead. This is the single brightest line in the product.

**2. Consent is explicit, recorded, and revocable.** Consent is never assumed from silence or from a relationship. It is captured, logged in a durable ledger, scoped to specific uses, and — for the living — revocable. The person is the author and owner of their own material.

**3. Living and deceased are governed by different rules.** A living person co-authors and consents in real time. A deceased person can only be represented according to consent they gave *before death*, enforced by family governance. The absence of pre-death consent is a "no," not a "maybe."

**4. The family holds a veto, and grief is protected.** Even with individual consent, the family stewardship structure can decline or pause a feature — especially anything posthumous — and the system provides off-ramps, retirement procedures, and human-support resources. The product is not therapy and says so plainly.

**5. AI is always disclosed.** Synthesized prose, restored or colorized images, voice reconstruction, and avatars are visibly labeled as AI-assisted (the MyHeritage watermark model). No one is ever misled about what is a real recording and what is a rendering.

---

## Component 1 — The consent ledger

The ledger is the spine of the whole framework: a durable, auditable record of who agreed to what, for which uses, when, and under what conditions. Every other component reads from and writes to it.

**What a consent record contains.** The person it concerns; the scope of use it permits (e.g., "family may hear my stories," "voice archive permitted," "no interactive avatar"); the audience tier it allows; whether it applies during life, after death, or both; the date and method of capture; and its current status (active, paused, revoked, or — for the deceased — locked).

**How consent is captured.** For the living, in their own voice during a session ("Is it alright if your grandchildren hear this one?") and through explicit settings, with help from the steward or initiator where needed. Crucially, low-friction for the narrator: a spoken yes is a valid, logged consent, so Eleanor never fills out a form. For sensitive or posthumous permissions, capture is deliberate and unambiguous, not buried in a default.

**Why it's auditable.** Diane must be able to *see* who can access what and why — the framework's legibility requirement. The ledger is the evidence that Eleanor's wishes are being honored, the record a court or a future steward could rely on, and the proof that any avatar was permitted. Legibility is itself a trust feature.

---

## Component 2 — The permission model

Granular, per-story privacy is how the chronicle holds a family's full range of material — the celebratory and the painful, the shared and the secret — without forcing a single visibility setting on everything.

**The audience tiers** (from the vision): **private** (only the author), **branch** (one line of the family), **family** (everyone in the chronicle), and **public**. Each story carries its own tier, set by its author at approval time and adjustable by the steward.

**Set by the author, governed by the steward.** Eleanor chooses the tier when she approves a story (Journey Map, phase 5). Diane can later adjust visibility as the family changes — granting a married-in cousin access to shared family stories while withholding a chapter Eleanor marked private to the immediate family (Personas, Diane's scenario).

**Time-gated release.** A tier can be conditioned on a future event: "release on a grandchild's 18th birthday," "open to the whole family after my death," "seal for fifty years." This is where the permission model meets the legacy features — and it must fire exactly as specified, never early.

---

## Component 3 — Living vs. deceased rules

This is the ethical heart of the framework, and a distinction that matters more than any role or generation — and one the everyday capture framing tends to gloss.

**For the living.** The person is present and in control. They co-author, consent in real time, set and change their own privacy tiers, edit by voice, and revoke. Consent here is a living conversation, continuously renewable and reversible.

**For the deceased.** Representation is permitted *only* to the extent the person consented before death, as recorded in the ledger and enforced by the steward. Three sub-rules:

- *No pre-death consent \= no posthumous avatar.* Silence is not permission. This directly answers the research finding that acceptance collapses without prior consent.  
- *Mutual consent for interaction.* Following the responsible-development standard, a posthumous experience requires both that the deceased consented to be represented and that the family governs who may interact with it — protecting the bereaved as well as the dead.  
- *Family veto and retirement.* The stewardship structure can decline or retire a posthumous feature even where individual consent existed, if it's harming the family's grieving. Avatar-retirement is a built-in procedure, not an afterthought.

---

## Component 4 — Avatar governance (the highest-risk feature)

Avatars get their own governance gate because they carry the most concentrated risk. Nothing here ships until Components 1–3 are live.

**The "their words only" guarantee, enforced technically.** The avatar is a retrieval interface over real recordings (the StoryFile model), explicitly not a generative ghost. If the person never recorded an answer, the avatar says so — it does not invent one. This is enforced in the system design, not just promised in a policy.

**Consent gates, checked at every step.** Before an avatar can be created: pre-death consent in the ledger (for the deceased) or active real-time consent (for the living). Before it can be interacted with: mutual-consent and family governance satisfied. At all times: visible AI disclosure.

**Retirement and off-ramps.** Every avatar has a retirement procedure — a dignified way to pause or take it down, invocable by the steward or family if it's interfering with healthy grief. The product surfaces human-support resources where appropriate and states plainly that it is not therapy.

**Living-person avatars are co-authored.** A living relative's avatar is built with them, consented in real time, and fully under their control — a different and far safer case than the posthumous one, and a reasonable place to learn before touching the posthumous version at all.

---

## Component 5 — Custody & the "story will"

A perpetual institution must answer the question the vision keeps returning to: *who holds the keys in eighty years?* Custody is what separates a living chronicle from an archive that dies in a dead account.

**The steward role and succession.** At any time, one (or a small set of) steward holds custody — managing membership, permissions, and consent integrity. The framework's load-bearing feature is **succession**: a steward names a successor (Diane names Sofia), so custody hands off cleanly when a steward dies or steps down. No single point of failure; no chronicle orphaned by one death.

**The "story will."** A documented instrument recording each contributor's wishes for after their death: what may be released and when, whether a posthumous avatar is permitted, who may interact with their material, and any sealing or timed-release conditions. It is the consent ledger's posthumous section, made formal — the "digital estate" the vision calls infrastructure.

**Durability and continuity.** Custody also means answering Diane's hard questions honestly: data portability and ownership, durable backup, and what happens to the chronicle if the company itself disappears. A family will not trust a multi-decade institution to a service that can vanish with their stories. Business continuity and data-export guarantees are part of the consent the steward gives on the family's behalf.

---

## Component 6 — AI disclosure & authenticity

The final principle, made concrete. Every AI-touched artifact is labeled.

**What gets disclosed.** Synthesized "speech-to-story" prose (with the original recording always preserved and foregrounded alongside it), restored/colorized/animated photos (the MyHeritage watermark model), reconstructed audio, and any avatar. The user always knows what is a real recording and what is a rendering.

**Why authenticity is a governance issue, not just a UX nicety.** The vision flags the "authenticity vs. polish" tension: AI rewriting can drift from a person's real words. Foregrounding the original voice is both an honesty commitment and a hedge — if the synthesized prose ever misrepresents, the source of truth is one tap away. Disclosure protects the dead from being misquoted and the living from being misrepresented.

---

## How the steward operates it (Diane's control surface)

The framework is only as good as the tools that make it usable. Diane's steward view brings the six components together into a few legible controls:

- **Membership** — admit, remove, and tier new members as the family grows (births, marriages-in, reconnections).  
- **Permissions** — see and adjust every story's audience tier; the access map is legible at a glance ("who can see what, and why").  
- **Consent ledger** — review and confirm recorded consents; flag anything missing consent before it's used.  
- **Story wills & posthumous controls** — honor each person's recorded wishes; gate any avatar against the ledger.  
- **Succession** — name the next steward; confirm the chronicle survives her.  
- **Review queue** — gaps, contradictions, and consent gaps surfaced gently for resolution.

The design intent (from the Personas doc): make Diane feel like a trusted custodian of a living heirloom, not an IT administrator. Automation handles the tedium; the responsibility stays light, but the controls stay legible.

---

## Build sequence (what gates what)

The dependencies are strict, because the whole point is that powerful features cannot precede their guardrails.

**Foundation, first:** the consent ledger (Component 1) and the permission model (Component 2). Nothing sensitive ships without these. They also power the everyday trust features — Eleanor's approval, per-story privacy — so they earn their keep immediately.

**Governance, second:** living-vs-deceased rules (Component 3), custody and the story will (Component 5), and AI disclosure (Component 6). This is the full institutional layer; it makes the chronicle safe to grow and to inherit.

**High-risk features, only after:** avatar governance (Component 4) — and therefore avatars themselves. The vision's instruction is the gate: *build the consent/estate framework before any avatar feature ships.* This document is that framework; the avatar waits behind it.

---

## Sources

- Griefbots / deadbots and the responsible-development consensus (consent, postmortem privacy, retirement procedures, transparency, mutual consent): [Griefbots, Deadbots, Postmortem Avatars — Philosophy & Technology (Springer, 2024)](https://link.springer.com/article/10.1007/s13347-024-00744-w); [Schwartz Reisman Institute — griefbots, human dignity, and AI regulation](https://srinstitute.utoronto.ca/news/griefbots-ai-human-dignity-law-regulation); [Scientific American — griefbots and ethical concerns](https://www.scientificamerican.com/podcast/episode/griefbots-create-digital-immortality-and-raise-ethical-concerns-around-ai/).  
- StoryFile's "their words only" retrieval model and AI principles: [StoryFile's AI Principles](https://storyfile.com/storyfiles-ai-principles/); [NYU JIPEL — ethical and legal dilemmas of StoryFile and Conversa](https://jipel.law.nyu.edu/preserving-the-past-using-tools-of-the-future-the-ethical-and-legal-dilemmas-of-storyfile-and-conversa/).  
