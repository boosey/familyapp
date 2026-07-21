# Sequenced Backlog — first application of the prioritization method

*Resolves [#74](https://github.com/boosey/familyapp/issues/74) under the Wayfinder map [#69](https://github.com/boosey/familyapp/issues/69). The reconciled, adoption-optimized, sequenced backlog produced by running the two-layer method (`…-eligibility-layer.md` + `…-value-score-rubric.md`) over the corpus (`…-candidate-corpus.md`). Objective: **adoption / validation** (no real families yet).*

**Headline:** 26 coarse epics → **9 eligible core-loop bets** + a triggered parking lot. The method collapses a wishlist into a coherent validation sequence and defers everything whose value isn't yet legible.

**Status (2026-07-20):** C26 Clerk go-live and the later P0 (mobile-web responsive layouts — see `Family-Chronicle-Prioritized-Backlog.md`) are **shipped**. **Next build item: C12 / seq #2 — Follow-up questions on published stories.**

---

## Part A — The eligible, sequenced backlog

Ordered by value score, adjusted for two hard edges (see Part B). Scores are `2·Impact + 2·Learning + 1·Confidence + 1·Reversibility + 1·Effort`, normalized to 100.

| Seq | Epic | Imp | Learn | Conf | Rev | Eff | /100 |
|:-:|---|:-:|:-:|:-:|:-:|:-:|:-:|
| ~~1~~ | ~~**C26 — Clerk go-live**~~ ✅ shipped 2026-07-17 | 5 | 2 | 5 | 4 | 4 | 77 |
| **2** | **C12 — Follow-up questions on published stories** (the asks-back arm) **← next** | 5 | 5 | 4 | 4 | 3 | 89 |
| **3** | **C10a — Basic story receipt / payoff** (family receives & feels it) | 5 | 4 | 4 | 4 | 3 | 83 |
| **4** | **C3 — Narrator onboarding / setup-by-a-relative** | 5 | 4 | 3 | 4 | 3 | 80 |
| **5** | **C1 — Richer AI interviewer + C2a gap-detection** | 4 | 5 | 3 | 4 | 3 | 80 |
| **6** | **C4 — Capture reliability & job-failure recovery** (GH#11) | 4 | 2 | 4 | 4 | 3 | 66 |
| **7** | **C13a — Notification-delivery capability** (enabler) | 4 | 2 | 3 | 3 | 3 | 60 |
| **8** | **C13b — Loop-event pings** ("story for you" / "question answered") | 4 | 3 | 4 | 4 | 4 | 74 |
| **9** | **C17 — Album & upload hardening** (GH#20 direct-to-storage, GH#21 EXIF) | 3 | 1 | 5 | 4 | 4 | 60 |

**The narrative the sequence tells from here:** close the ask-back loop → make receipt land → get narrators onboarded → deepen the interviewer so stories are worth caring about → harden capture → wire the notification heartbeat that tells families to return.

---

## Part B — Sequencing overrides (score ranks; hard edges re-order)

The value score is a *ranking* input, not the final sequence. Two hard constraints re-order it:

1. **C26 Clerk go-live → position 1 despite its 77.** *(Resolved — shipped 2026-07-17.)* Its low *learning* score (2) dragged the number, but it was a **hard precondition for the entire objective**: without live auth there are no real families. A later P0 (mobile-web responsive) also preempted the queue and is now shipped — see the Prioritized Backlog.
2. **C13a before C13b.** The loop-event pings (74) outscore the delivery capability (60) they stand on, but the dependency edge forces the enabler first.

*General rule for re-runs:* after score-ranking, honor (a) hard prerequisites that gate the objective and (b) capability-dependency edges among eligible items.

---

## Part C — The parking lot (with revisit triggers)

Each parked item carries the trigger that would bring it back — the parking lot is a queue, not a graveyard.

### Ethics-parked → revisit at institution stage
- **C22 — DNA / genetic module.** Denylisted data class (per the eligibility layer).

### Premature-parked → revisit after ~3 families complete the core loop
*(retention / moat / scale / engagement-depth whose value isn't legible until the loop is validated)*

| Epic | Why parked |
|---|---|
| C5 Native mobile app | scale/polish; the wedge is zero-app by design |
| C6 Alternative entry channels | validate one channel first (roadmap intent); phone also blocked on `realtime/telephony` |
| C7 Video capture & delivery | engagement-depth; also blocked on `video-storage+transcode` |
| C8 Live family video calls | P6 feature; blocked on video + realtime |
| C9 Ambient / dinner-table capture | P6; mechanism-risk (consent) |
| C11 Social layer (reactions/comments/threads) | retention (Group D) before validation |
| C13c Weekly digest + narrator nudges | generic re-engagement (not loop events) |
| C14 External-data enrichment & integrations | the moat — explicitly deferred until validated; feasibility-uncertain |
| C15 Remaining kinship (#36–39) | enrichment/structure; core kinship already shipped |
| C16 Photo face-tagging | enrichment; feasibility-uncertain (vendor/accuracy) |
| C18 Family key-dates | return-visit optimization before validation — the textbook premature bet |
| C2b Enrichment/timeline fact extraction | moat precursor (the gap-detection slice C2a is eligible) |
| C10b Rich timeline / feed | engagement-depth beyond basic receipt |
| C19 Steward console & governance | institution (P4) before validation |
| C20 Custody, estate & time-gated release | institution (P4) |
| C21 Narrator interactive testimony | P5; secondary: blocked on `governance` + `their-words-only-retrieval`. NOT ethics-parked — its risk is mechanism, not consent. |
| C23 Mysteries / geolocation / sensory | P6 engagement-depth |
| C24 Legacy & forward-time | P6 |
| C25 Further innovations (heritage-language, health, cross-family match) | P6+ |

### Out of scope → returns only if the destination is redrawn
- **C18-coordination / logistics (addresses, event planning).** A family-logistics-app feature, not a chronicle feature.
- **Multi-family identity/data model.** The roadmap's foundational open question (`Family-Chronicle-Identity-Data-Model.md`); its own effort. (Membership *plumbing* — ADR-0019 soft-link, ADR-0021 filter/designator, #45/#46 — is already shipped.)

### Already shipped (not candidates)
C26 Clerk go-live · P0 mobile-web responsive layouts · #45/#46 family filter + short_name · #30–35 kinship provenance/edges/governance/subjects · #19 album-in-hub · kinship membership plumbing. *(#74 note: verify against `origin/master`; issues open-but-done.)*

---

## Part D — Feasibility spikes & slice-decomposition (ticket item 4)

- **No research spikes fire this round.** Every feasibility-uncertain candidate (native app, video infra, face-tagging vendor, era/context inference, external-data access) is *parked*, not an eligible contender — so its spike stays fog until a future re-run promotes it.
- **Slice-decomposition candidates:** the remaining front coarse epics — **C12, C10a, C3, C1, C4** — (C26 shipped) are near enough the front to slice into buildable issues. That work graduates as its own task (filing the top slices as GitHub issues), separate from the strategic/narrative landing in #75.
