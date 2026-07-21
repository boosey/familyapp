# ADR-0013 — The interviewer consults an auditable LLM evaluation for follow-ups

Status: Accepted (amended 2026-07-20)

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

- **Proposers are pluggable.** More than one propose path may feed the same dispose function. The
  product policy is a fixed **cascade** (not a free blend):
  1. **System probes** — deterministic, no LLM (e.g. temporal dating when story-date context says
     the telling has no resolvable date). A probe that does not apply is a no-op; it must not block
     later stages. At most one probe kind per thread/session via explicit latches.
  2. **Gap detection** — thin LLM extraction of missing facts (`createGapFollowUpEvaluator`).
  3. **Deepen** — free-form interestingness (`createLlmFollowUpEvaluator`).
  Later stages run only when earlier stages produced no *selected* candidate after dispose.
- Each propose path returns a **ranked list of candidate threads**, each tagged
  `{ type, sensitivity, confidence, narratorOpened }` (system probes synthesize a single tagged
  candidate with a fixed `modelId` such as `system:story-date`).
- **Code enforces hard rules** over those tags plus state it fully owns — the rapport/sensitivity
  gate, the caps, the distress/off-ramp short-circuit, and a cheap lexical anti-repeat backstop —
  via pure `decideFollowUp`. Ranking is confidence-order, with an **emotional-door veto** and a
  deterministic tie-break.
- Shared orchestration lives in `proposeAndDisposeFollowUp`; surfaces differ only in *when* they
  run it and *whether* they persist the ledger / queue for the next turn.
- `PromptIntent.follow_up.origin` records the winning stage for phrasing:
  `system` | `gap` | `reflection` (deepen), plus optional `gapKind`.
- Every follow-up turn on the answer surface writes an append-only **follow-up decision record**:
  candidates and tags, each disposition with a coded reason, the selected candidate (or "none"),
  the phrased line, and the narrator's outcome. Ledger `evaluatorModelId` reflects the winning stage.

The invariant is therefore *amended, not abandoned*: proposers (LLM or system) propose options; the
deterministic picker chooses and gates; the loop never hands conversational control to the model.
Auditability is preserved by the decision record.

## Consequences

- A new evaluator seam with a mock (vendor SDKs never leak past adapters, per the architecture test).
  The `phraser` phrases the chosen `follow_up` intent, shading by `origin` / `gapKind` (including
  gentle temporal dating guidance).
- A `SystemFollowUpProbe` seam for deterministic proposers; story-dates temporal is the first probe
  (`createTemporalFollowUpProbe`). Landing PR #249 wires dating context into the probe only — it
  must not reintroduce an inline `proposeTemporalFollowUp` in the turn loop.
- A new append-only table for the decision record; it stores short `threadSeed` paraphrases
  (title/summary-tier, derived), kept in the interviewer-operational tier, not behind the story
  front door.
- The decision record is what makes the feature *tunable*: real sessions can be replayed to A/B the
  evaluator prompt against recorded proposals — the eval loop the prompts-are-data principle wants.
- The same propose-then-audited-dispose shape governs the asker-side **Ask suggestion** (separately
  flagged), whose disposition is simply "surfaced / stayed silent."
- ADR-0012 multi-take Story UX on `/hub/answer` is unchanged; this ADR is the proposer/orchestration
  layer only.
