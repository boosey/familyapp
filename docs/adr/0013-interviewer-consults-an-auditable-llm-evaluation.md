# ADR-0013 — The interviewer consults an auditable LLM evaluation for follow-ups

Status: Proposed (2026-07-02)

## Context

The interviewer's load-bearing conceit is "**the LLM only phrases; our code decides**." `pickNextIntent`
is a deterministic function; `phraser.ts` is the *only* place the model enters, and it is forbidden
from deciding anything — it renders a chosen seed. The turn loop is "a controlled turn loop, NOT an
open chat."

A **follow-up** breaks this cleanly. Deciding *whether* an answer is worth deepening, and *on what*,
is inherently semantic — code cannot look at a wedding transcript and know the stained glass is the
interesting thread. So the feature necessarily moves a *decision* into an LLM call. The risk is that
the controlled loop degrades into a chatbot, and that decisions become unauditable — unacceptable in
a codebase whose spine is auditable consent.

The lean alternative — a single call that both decides and phrases — is fewer round-trips, but the
model is then driving, and it cannot emit a trustworthy record of what it *considered and rejected*
(it would be marking its own homework in prose).

## Decision

Follow-ups use a **propose-then-dispose** split, and every disposition is recorded.

- A dedicated **evaluator seam** (prompts-as-data, per the prompts-are-data principle) reads the
  take's transcript + light context (the prompt it answered, covered material, turn count, remaining
  sensitivity budget) and returns a **ranked list of candidate threads**, each tagged
  `{ type, sensitivity, confidence, narratorOpened }`. The model does the semantic work: assessing
  interestingness, sensitivity, and novelty (it is *given* what is already covered and told to
  propose only novel threads).
- **Code enforces hard rules** over those tags plus state it fully owns — the rapport/sensitivity
  gate, the caps, the distress/off-ramp short-circuit, and a cheap lexical anti-repeat backstop. Code
  does not *compute* semantics; it applies arithmetic to the model's tags and hard counters. Ranking
  is confidence-order, with an **emotional-door veto** (an `emotional` candidate is eligible only
  when the narrator opened that door) and a deterministic tie-break.
- Every follow-up turn writes an append-only **follow-up decision record**: all candidates and their
  tags, each candidate's disposition with a coded reason (`below_rapport | duplicate | over_cap |
  distress_shortcircuit | thin_answer | not_selected`), the selected candidate (or "none → thread
  ends"), the phrased line, and the narrator's outcome. Nothing is discarded without a recorded
  reason — the same discipline as the consent ledger and the L1→L2→L3 prose revisions.

The invariant is therefore *amended, not abandoned*: the LLM proposes options; the deterministic
picker chooses and gates; the loop never hands conversational control to the model. Auditability is
preserved by the decision record, not by keeping the LLM out of the decision.

## Consequences

- A new evaluator seam with a mock (vendor SDKs never leak past adapters, per the architecture test).
  The `phraser` is unchanged — it phrases the chosen `follow_up` intent as its template already does.
- A new append-only table for the decision record; it stores short `threadSeed` paraphrases
  (title/summary-tier, derived), kept in the interviewer-operational tier, not behind the story
  front door.
- The decision record is what makes the feature *tunable*: real sessions can be replayed to A/B the
  evaluator prompt against recorded proposals — the eval loop the prompts-are-data principle wants.
- The same propose-then-audited-dispose shape governs the asker-side **Ask suggestion** (separately
  flagged), whose disposition is simply "surfaced / stayed silent."
