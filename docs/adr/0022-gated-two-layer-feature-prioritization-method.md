# ADR-0022 — A gated, two-layer feature-prioritization method

Status: Accepted (2026-07-15)

A reusable method for prioritizing a large candidate backlog: **Layer 1 eligibility gates** (pass/fail, run first) then **Layer 2 value scoring** (over survivors only). Gated, *not* blended — a single blended score would sequence powerful features ahead of the guardrails they depend on, the exact failure the Release Roadmap already guards against. The method is objective-parameterized and re-runnable; this ADR fixes the machinery and records the **adoption/validation** objective as its first application.

*Charted and applied via the Wayfinder map [#69](https://github.com/boosey/familyapp/issues/69). First-pass working artifacts (historical): `docs/99-pruned/wayfinder/2026-07-15-{eligibility-layer,value-score-rubric,candidate-corpus,sequenced-backlog}.md`; the live sequenced backlog is `docs/strategy/prioritized-backlog.md`. This ADR is the durable, canonical statement of the method.*

## Context

We had a 26-epic candidate backlog reconciled from four sources (18 new ideas ∪ Release Roadmap Phases 2–6+ ∪ open GitHub issues ∪ agent-proposed additions) and no principled way to sequence it. A naive weighted score blends value and risk, which lets a high-value feature outrank the guardrail that makes it safe — e.g. narrator interactive testimony scoring above the governance layer it requires. The Release Roadmap's central rule is "never let a powerful feature precede its guardrail," and the method has to encode that rule structurally, not hope the scorer respects it.

Two further constraints shaped the design:
- **No real families use the product yet.** The objective for the first run is *adoption/validation*, and "impact" means "removes a real barrier to a family adopting and completing the core loop" (narrator records → family receives → asks back).
- **Implementation time is compressed and unpredictable** (AI coding agents), so effort is the least reliable input — a fact that rules out any formula giving effort denominator leverage.

## Decision

### Layer 1 — Eligibility (a router, not a filter)

Run **before** any scoring. Rather than a bare pass/fail, each candidate is **routed** to one typed disposition carrying a **revisit trigger**, so the parked set is a queue with triggers, not a graveyard:

`eligible` · `ethics-parked` · `premature-parked` · `blocked-dependency` · `decompose`

**Three gates, evaluated most-binding-first** (the highest failed gate wins the disposition; other failures recorded as secondary):

1. **Stage-ethics denylist** (revisit: institution stage). Vetoes only (a) categorically dangerous **data classes** and (b) features whose **mechanism** manufactures new risk (the latter are actually caught by gate 3). *Governing consent principle:* **appearing in content or a public record IS the consent for chronicle use — affirmative consent from every represented person is not required.** Over-rotating on consent sterilizes the archive. Denylist at the adoption stage: **DNA/genetic data only**.
2. **Adoption baseline** / premature-at-validation (revisit: after ~**3** families complete the core loop). Fails a feature that optimizes **retention, moat, scale, or engagement-depth** before the core loop is validated. Distinct from the Layer-2 impact dimension: this gate asks *"is the value legible pre-validation?"*, the score asks *"how big is it?"*.
3. **Guardrail-dependency** (revisit: when a capability ships). Each candidate declares the **named platform capabilities** it stands on, from a bounded vocabulary; guardrail capabilities (governance layer, "their-words-only" retrieval, etc.) live in that vocabulary, so the roadmap's "guardrail-first" rule is enforced as an ordinary dependency check. "Shipped" = merged to `origin/master`; capabilities named at a **binary** grain. Passes iff all are shipped.

A **mixed epic** (some slices pass, some fail) routes to `decompose` — split near the frontier and re-gate the slices.

### Layer 2 — Value score (weighted additive)

Scores **only** `eligible` items. Five dimensions, each **1–5, integer, anchored, higher = more desirable** (effort and reversibility reverse-coded), one uniform range so the weights — not a hidden scale — carry importance:

```
Score = 2·Impact-on-adoption + 2·Learning-value + 1·Confidence + 1·Reversibility + 1·Effort
```

Max raw 35, normalized to 100. **Weighted additive, not RICE/WSJF (ratio) or multiplicative EV** — because effort is the least reliable input (no denominator leverage) and additive scoring avoids the confidence×reversibility double-punish (a reversible low-confidence bet is one you *want* at a validation stage).

**Anchors (1 / 3 / 5):**
- *Impact-on-adoption* — removes no barrier / eases a friction some hit / removes a barrier that **blocks** adopting or completing the loop.
- *Learning-value* — teaches nothing new / sharpens a secondary assumption / decisively validates or invalidates a **core** hypothesis.
- *Confidence* — no idea if/how / plausible, known unknowns / proven pattern, done before.
- *Reversibility* — one-way door / undoable with effort / trivially toggled off.
- *Effort* — large multi-capability build / focused increment / thin slice or config.

**Tie-breaks** (in order): impact-on-adoption → effort (lower) → reversibility (higher).

**Sequencing overrides** (the score ranks; two hard edges re-order): honor (a) hard prerequisites that gate the whole objective and (b) capability-dependency edges among eligible items, even when they outrank a higher-scoring item.

### The reusability knob

The **weight vector encodes the objective** — it is the single edit that re-points the method for a different stage. This pass (adoption/validation) = `2/2/1/1/1`. A differentiation-objective re-run would re-tune it (restore strategic-moat-fit as a dimension, raise effort) without changing the machinery. Two dimensions were **cut** for this pass and belong to that future re-run: **strategic-moat-fit** (re-imports what the baseline gate parks) and **reach/frequency** (speculative at zero users).

## Consequences

- **The method collapses a wishlist to a validation sequence.** First application: 26 epics → 9 eligible core-loop bets + a triggered parking lot (see the Prioritized Backlog doc).
- **The parking lot is durable and self-clearing** — each parked item names the event that brings it back (a capability shipping, ~3 families, the institution stage), so re-runs start from triggers rather than re-litigating.
- **"Shipped = on `origin/master`"** makes the dependency gate mechanically checkable but means the gate must be re-run against the live tree, not memory.
- **Wiring the method into the triage label flow** (`needs-triage → ready-for-agent`) is deliberately **out of scope** until it proves out on more than one batch.
- **Re-running for a new objective** is a weight-vector edit + a fresh eligibility pass; the artifacts and this ADR are the template.
