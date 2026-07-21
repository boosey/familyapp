# Value-Score Rubric — the prioritization method's Layer 2

*Resolves [#71](https://github.com/boosey/familyapp/issues/71) under the Wayfinder map [#69](https://github.com/boosey/familyapp/issues/69). Ready to embed in the method ADR ([#73](https://github.com/boosey/familyapp/issues/73)) and run in "Apply eligibility + coarse-rank" ([#74](https://github.com/boosey/familyapp/issues/74)). Companion to the Layer-1 eligibility layer (`docs/wayfinder/2026-07-15-eligibility-layer.md`). Stage this pass targets: **adoption / validation**.*

---

## What Layer 2 scores

Only items that passed **all** eligibility gates (Layer 1). Every survivor is already adoption-relevant, buildable-now (dependencies shipped), stage-licensed, and not premature. Layer 2 therefore **ranks among good bets** — it does not re-litigate whether an item belongs at this stage.

Scored at **epic grain** (the map's lazy-decomposition rule). Epics that eligibility routed to `decompose` get their individual slices scored at #74.

---

## The five dimensions

Each scored **1–5, integer, anchored, higher = more desirable** (effort and reversibility are reverse-coded so 5 is always best). One uniform range across all five, so the explicit **weights** — not a hidden scale range — carry importance.

| Dimension | Weight | 1 | 3 | 5 |
|---|---|---|---|---|
| **Impact-on-adoption** | ×2 | removes no real adoption/core-loop barrier | eases a friction some families hit | removes a barrier that today *blocks* a family adopting or completing the core loop |
| **Learning-value** | ×2 | teaches nothing we don't already know | sharpens a secondary assumption | decisively validates/invalidates a *core* hypothesis (will narrators engage? will families return?) |
| **Confidence** (feasibility) | ×1 | no idea if it works or how | plausible; known unknowns | proven pattern; we've done it before |
| **Reversibility** | ×1 | one-way door (data-model / consent commitment, hard to unwind) | undoable with effort | trivially toggled off, no residue |
| **Effort** | ×1 | large multi-capability build | focused increment | thin slice / config-level change |

The **core loop** referenced by Impact/Learning: narrator records → family receives → asks back.

---

## Formula

**Weighted additive:**

```
Score = 2·Impact + 2·Learning + 1·Confidence + 1·Reversibility + 1·Effort
```

Max raw = 35. **Normalize to 100** for presentation: `Score₁₀₀ = round(raw / 35 × 100)`.

**Why additive, not RICE/WSJF (ratio) or a multiplicative EV composite:**
- The roadmap declares implementation time "heavily compressed and unpredictable" with AI agents — so **effort is the least reliable input**. A ratio (`value ÷ effort`) hands the noisiest estimate the most leverage and rewards trivial low-effort work. Additive keeps effort as one modest term.
- Additive sidesteps the confidence×reversibility **double-punish**: at a validation stage a *reversible* low-confidence bet is one you *want* (cheap to try, cheap to undo). Multiplying the two risk terms would wrongly hammer it twice; adding them lets reversibility compensate for low confidence.
- Transparent and re-runnable by a solo dev months later; no ratio blow-ups; hard to game.

---

## Tie-breaks

When normalized scores tie, apply in order:

1. **Impact-on-adoption** (higher) — the objective breaks its own ties.
2. **Effort** (lower / higher score) — ship the faster one first for sooner feedback.
3. **Reversibility** (higher) — prefer the safer bet if still tied.

---

## The reusability knob

The **weight vector is where the objective enters Layer 2** — it is the single edit that re-points the whole method for a different stage.

- **This pass (adoption / validation): `2 / 2 / 1 / 1 / 1`** (Impact / Learning / Confidence / Reversibility / Effort).
- A future re-run with a **differentiation** objective would re-tune it (e.g. restore strategic-moat-fit as a dimension and raise Effort's weight), without changing the machinery.

---

## Dimensions cut for this pass (and why)

- **Strategic-moat-fit — cut.** Moat is a later-stage payoff; the Layer-1 baseline gate already **parks** moat-before-validation items as premature. Scoring survivors on moat-fit would re-import exactly what the gate filtered and fight the adoption objective. Belongs in a differentiation-objective re-run.
- **Reach / frequency — cut.** Reach = users affected; there are **zero families**, so any reach number is speculation that a multiplier would merely reward for optimism. Real breadth signal is folded into Impact ("removes a barrier for *most* families" scores higher).
- **Learning-value — kept and promoted** to co-primary (×2): at a validation stage, resolving a core uncertainty is worth a build even at modest impact. Held distinct from Impact — Impact = "removes a barrier," Learning = "resolves an uncertainty."
- **Reversibility — kept as a full dimension** (not merely a tie-break): at the validation stage, favoring cheap-to-undo bets is a first-class concern.
