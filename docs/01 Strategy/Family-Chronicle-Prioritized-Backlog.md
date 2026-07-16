# The Prioritized Backlog — first application of the prioritization method

*Companion to the Release Roadmap. Where the Roadmap sequences the whole north star by **dependency and risk across phases**, this doc answers the narrower, live question: **at the adoption/validation stage, with no real families yet, what do we build first?** It is the output of running the gated two-layer method (ADR-0022) over the reconciled 26-epic candidate corpus. It refines the Roadmap's early-phase sequencing; it does not replace the phase logic. Where a phase-reading and this backlog conflict on "what's next," this backlog wins for the current stage — because it is the phase logic passed through the eligibility gates and scored for adoption.*

*Charted and applied via Wayfinder map [#69](https://github.com/boosey/familyapp/issues/69). Method: **ADR-0022**. Working artifacts: `docs/wayfinder/2026-07-15-*.md`.*

---

## The headline

The method took a **26-epic wishlist** (18 new ideas ∪ Roadmap Phases 2–6+ ∪ open issues ∪ agent-proposed) and collapsed it to **9 eligible core-loop bets + a triggered parking lot**. That collapse *is* the value: at a validation stage, most of the backlog optimizes retention, moat, scale, or engagement-depth whose worth isn't yet legible — so it's deferred with an explicit trigger, not argued about.

The objective was **adoption/validation**: *impact* = "removes a real barrier to a family adopting and completing the core loop" — narrator records → family receives → **asks back**.

---

## The sequenced backlog (build in this order)

| Seq | Epic | /100 | What it is |
|:-:|---|:-:|---|
| **1** | **Clerk go-live** | 77 | Live auth (acceptance + live keys). *Prerequisite override* — without it no real family exists to validate with. |
| **2** | **Follow-up questions on published stories** | 89 | The "asks-back" arm of the core loop; the Roadmap's highest-leverage trigger. |
| **3** | **Basic story receipt / payoff** | 83 | The family receives and *feels* the story — the "family is moved" hypothesis. |
| **4** | **Narrator onboarding / setup-by-a-relative** | 80 | Getting the elder set up — the first adoption barrier. |
| **5** | **Richer AI interviewer + gap-detection** | 80 | Deeper sessions so stories are "good enough that family cares." |
| **6** | **Capture reliability & job-failure recovery** | 66 | A failed recording kills trust in the wedge. |
| **7** | **Notification-delivery capability** | 60 | The enabler for loop-event pings (→ 8). |
| **8** | **Loop-event pings** | 74 | "A story landed for you" / "your question was answered" — tells the family to return. Gated behind (7). |
| **9** | **Album & upload hardening** | 60 | Fix direct-to-storage uploads (currently broken for real files) + EXIF coverage. |

**Two sequencing overrides** the raw score doesn't capture: **Clerk go-live** jumps to #1 as a hard prerequisite (nothing downstream is learnable without live families, despite its low *learning* score); **notification-delivery** precedes its higher-scoring **loop-event pings** on the capability edge.

**The story the sequence tells:** turn auth on → close the ask-back loop → make receipt land → onboard narrators → deepen the interviewer → harden capture → wire the notification heartbeat that brings families back.

---

## The parking lot (with revisit triggers)

Nothing here is rejected — each item names the event that brings it back.

### Ethics-parked → revisit at the institution stage
- **DNA / genetic module** — denylisted data class (surprise kin, law-enforcement exposure, breach precedent).

### Premature-parked → revisit after ~3 families complete the core loop
Retention / moat / scale / engagement-depth whose value isn't legible until the loop is validated:
Native mobile app · alternative entry channels (phone/SMS) · video capture & delivery · live family video calls · ambient/dinner-table capture · social layer (reactions/comments/threads) · weekly digest + narrator nudges · **external-data enrichment & integrations (the moat)** · remaining kinship (#36–39) · photo face-tagging · family key-dates · enrichment/timeline fact-extraction · rich timeline/feed · steward console & governance · custody/estate/time-gated release · narrator interactive testimony *(also blocked on `governance` + `their-words-only-retrieval`; parked for stage, not consent)* · mysteries/geolocation/sensory · legacy & forward-time · further innovations (heritage-language, health, cross-family match).

### Parked strategy note (not a feature)
- **Monetization** — where the wedge meets the business. A strategy decision (the buyer and the narrator are different humans), and one of the Roadmap's two standing open questions — its own effort, not ranked by this method.

### Out of scope (returns only if the destination is redrawn)
- **Family coordination / logistics** (event planning, addresses) — a family-logistics-app feature, not a chronicle feature.
- **Multi-family identity/data model** — the Roadmap's foundational open question (`Family-Chronicle-Identity-Data-Model.md`); its own effort. (Membership *plumbing* — ADR-0019 soft-link, ADR-0021 filter/designator — is already shipped.)

### Already shipped (not candidates)
Family filter + short_name (#45/#46) · kinship provenance/edges/governance/subjects (#30–35) · album-in-hub (#19) · kinship membership plumbing.

---

## What this unblocked next

- **Slice & file the top eligible epics as issues** — the frontmost coarse epics (Clerk go-live, follow-up-on-published, basic receipt, narrator onboarding, richer interviewer, capture reliability) graduate into buildable `ready-for-agent` issues ([#76](https://github.com/boosey/familyapp/issues/76)).
- **Feasibility spikes stay fog** — every feasibility-uncertain candidate (native app, video infra, face-tagging vendor, external-data access) is currently *parked*, so no research spike fires until a re-run promotes one to a contender.
