# Eligibility Layer — the prioritization method's Layer 1

*Resolves [#70](https://github.com/boosey/familyapp/issues/70) under the Wayfinder map [#69](https://github.com/boosey/familyapp/issues/69). Ready to embed in the method ADR ([#73](https://github.com/boosey/familyapp/issues/73)) and run in "Apply eligibility + coarse-rank" ([#74](https://github.com/boosey/familyapp/issues/74)). Stage this pass targets: **adoption / validation** — no real families are using the product yet.*

---

## Model: a router, not a filter

Layer 1 does not emit a bare pass/fail. It **routes** each candidate to exactly one **primary disposition** carrying a **revisit trigger**; any additional failed-gate reasons are recorded as secondary. The parked buckets therefore form a **queue with triggers**, not a graveyard — each trigger is a future graduation event for the map's fog.

| Disposition | Meaning | Revisit trigger |
|---|---|---|
| `eligible` | passes all gates → proceeds to Layer-2 value scoring | — |
| `ethics-parked` | a denylisted data class | institution stage |
| `premature-parked` | optimizes retention / moat / scale / engagement-depth before the core loop is validated | after ~3 families complete the core loop |
| `blocked-dependency` | a named platform capability it stands on isn't shipped | when capability X ships |
| `decompose` | epic contains both eligible and ineligible slices | split at #74, then re-gate the slices |

---

## The three gates

Evaluated in this **precedence — most-binding gate wins the primary disposition**, so nothing resurfaces before it can actually proceed:

1. **Stage-ethics denylist** (revisit: institution stage — furthest out)
2. **Adoption baseline** / premature-at-validation (revisit: after ~3 families — binds even if dependencies land)
3. **Guardrail-dependency** (revisit: when a capability ships — nearest, most concrete)

A candidate that fails several gets the highest failed gate as its primary disposition; the rest are recorded as secondary reasons.

### Gate 1 — Stage-ethics denylist

**Governing consent principle.** Appearing in content or a public record *is* the consent for chronicle use. Affirmative consent from every represented person is **not** required — families identify faces in photos and match public records without asking; the dead can't consent, yet their content is precisely the chronicle's purpose. Over-rotating on consent would make most content unusable, defeating the product.

The gate therefore vetoes only:
- **(a) categorically dangerous data classes**, and
- **(b) features whose *mechanism* manufactures new risk** — and those are caught by the **guardrail-dependency** gate (Gate 3), *not here*.

**Denylist at the adoption/validation stage — one entry:**
- **DNA / genetic data.** The vision's single most sensitive category (surprise kin, law-enforcement exposure, the 23andMe breach/bankruptcy precedent). Parked regardless of dependency state. Revisit: institution stage **and** a built opt-in-with-deletion instrument.

Explicitly **NOT** ethics-vetoed (they face only Gates 2/3 like anything else): face recognition / auto-tagging of family members (presence in the photo is the consent), public-record / newspaper / census fusion (matching public records is not an invasion of privacy), posthumous use of a person's already-captured content. Posthumous *interactive testimony* is ineligible now via Gate 3 (no governance layer, no "their-words-only" retrieval-integrity capability) — a mechanism-risk dependency, not an ethics line.

### Gate 2 — Adoption baseline (premature-at-validation)

The null option every feature must beat: **"just ship to a family and watch."**

- **Fails** when the feature optimizes **retention, moat, scale, or engagement-depth** *before* the core loop — **narrator records → family receives → asks back** — is validated with even one real family.
- **Passes** when it plausibly removes a barrier to a family **adopting or completing the core loop itself** (entry-channel friction, capture reliability, the answer-back loop, a payoff surface that makes a family *feel* the result).

This gate is deliberately **distinct** from the Layer-2 `impact-on-adoption` scoring dimension:
- **Gate 2 (Layer 1, pass/fail):** *is this feature's value even legible pre-validation?*
- **Impact dimension (Layer 2, scored):** *among survivors, how big is the barrier it removes?*

**N = 3.** Revisit trigger on every `premature-parked` item: "after ~3 families complete the core loop." (Low, because we are pre-validation and should not build moat on speculation; >1, because 3 is a pattern rather than a single anecdote.)

### Gate 3 — Guardrail-dependency

Each candidate declares the **named platform capabilities** it stands on. **Guardrail capabilities** (e.g. governance/steward layer, "their-words-only" retrieval integrity) live in the same vocabulary — this is where the roadmap's "never let a powerful feature precede its guardrail" rule is enforced, folded into the ordinary dependency check rather than kept as a separate risk gate.

Mechanics:
- **Vocabulary:** a bounded set of ~8–12 named capability tokens, derived while assembling the corpus in [#72](https://github.com/boosey/familyapp/issues/72) (e.g. `photo-storage`, `people/identity-model`, `consent-ledger`, `kinship-graph`, `governance/steward-layer`, `their-words-only-retrieval`, `external-data-harness`, `video-storage+transcode`, `realtime/telephony` — final list set in #72).
- **"Shipped"** = merged to **`origin/master`** (no real users → master ≈ prod; deploy is continuous). Not "designed," not "on a branch."
- **Binary grain:** capabilities are named at a granularity where each is shipped-or-not. If a feature needs only *part* of a broad capability, that part is its own vocabulary token. No "50% shipped."
- **Pass** iff every listed capability is shipped.

---

## Two-tier grain

Eligibility runs at **epic grain** (the map's lazy-decomposition rule: coarse-rank epics, slice only near the frontier). An epic where some slices are eligible and some are not routes to **`decompose`** — split at #74 and re-gate the resulting slices — rather than a false whole-epic pass or park.

---

## Checklist (run order, per candidate)

1. Is it a **denylisted data class** (DNA)? → `ethics-parked`.
2. Does it optimize **retention/moat/scale/engagement-depth before the core loop is validated**? → `premature-parked`.
3. Are all its **named capabilities shipped on `origin/master`**? If any missing → `blocked-dependency`.
4. Is it a **mixed epic** (some slices pass, some fail)? → `decompose`.
5. Otherwise → **`eligible`** → hand to Layer-2 value scoring.

Record the primary disposition (highest failed gate) + its revisit trigger + any secondary reasons.
