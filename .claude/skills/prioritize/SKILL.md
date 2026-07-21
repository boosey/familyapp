---
name: prioritize
description: >-
  Decide what to build next for Family Chronicle by running a pass of the
  reusable gated two-layer feature-prioritization method (ADR-0022). Use
  whenever the user wants to prioritize features, sequence the backlog, figure
  out "what should I build next / what to work on," re-run the prioritization,
  re-rank the roadmap, re-score candidates, or when a parking-lot trigger has
  fired (e.g. "we now have real families," "capability X shipped," "here are
  some new feature ideas"). This is the discoverable entry point — the user does
  NOT need to remember the ADR number or the incantation.
---

# Run a prioritization pass

This is a **launcher**, not the method. The method lives in **`docs/adr/0022-gated-two-layer-feature-prioritization-method.md`** — read it and follow it. Do not restate or re-derive the gates/formula here; the ADR is the single source of truth, and this skill only makes it findable.

## Orient first (read these, in order)

1. **`docs/adr/0022-gated-two-layer-feature-prioritization-method.md`** — the machinery: Layer-1 eligibility router (3 gates) + Layer-2 weighted-additive value score. The **weight vector is the knob** that encodes the objective.
2. **`docs/strategy/prioritized-backlog.md`** — the last pass + its **"How to re-run this"** section (triggers, and the two levels of re-run). Start there.
3. **`docs/strategy/09-roadmap-and-deferred.md`** — shipped inventory + parked product ideas (Ask the archive, etc.) for corpus refresh.
4. **`docs/99-pruned/wayfinder/2026-07-15-*.md`** — optional fine grain from the first pass (eligibility layer, value rubric, candidate corpus). Historical; do not treat as product truth.

## Which re-run is this?

- **Re-run the *pass* (common).** The method is already decided; you are re-applying it. Do NOT open a Wayfinder map. Proceed below.
- **Re-decide the *method* (rare).** Only if the machinery itself is wrong (a gate misfires, the formula needs changing). Stop and run `/wayfinder` — that is a deciding effort, not an applying one.

## The pass (HITL — grill the human on the judgment calls)

Follow ADR-0022, but the shape is:

1. **Set the objective → the weight vector.** Confirm the stage with the human (adoption/validation? retention? differentiation/moat?). The objective *is* the weight vector; the current adoption pass = `2/2/1/1/1`. A differentiation pass restores strategic-moat-fit + reach and raises effort. **This is the human's decision — grill, don't assume.**
2. **Refresh the corpus.** Add any new candidate ideas + open GitHub issues; re-check each item's dependency capabilities against **`origin/master`** ("shipped" = merged). Carry forward the parking lot and check which revisit triggers have fired. Pull parked ideas from `docs/strategy/09-roadmap-and-deferred.md`.
3. **Run the eligibility router** (mechanical): route every candidate to `eligible` / `ethics-parked` / `premature-parked` / `blocked-dependency` / `decompose`, precedence most-binding-first. Present the pass for the human to confirm/override.
4. **Score the survivors** on the rubric (1–5 anchored, weighted per the objective's vector) → normalized /100. **Grill the human on the scores** — recommend, don't dictate. Apply tie-breaks and the sequencing overrides (hard prerequisites, capability edges).
5. **Emit the outputs:** update `docs/strategy/prioritized-backlog.md` (new sequence + refreshed parking lot with triggers) and file the top eligible slices as `ready-for-agent` GitHub issues (don't duplicate existing ones — thread them in).

## Guardrails

- The consent principle binds the ethics gate: *being in content or a public record IS consent* — the denylist at the adoption stage is DNA only. Don't over-rotate.
- Keep the human in the loop for the weight vector and the scores — those are judgment, not computation.
- If you find yourself running this often, that frequency is the signal to grow this launcher into a fuller skill (automate corpus-assembly + scoring; keep the grilling).
