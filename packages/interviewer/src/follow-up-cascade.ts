/**
 * proposeAndDisposeFollowUp — shared cascade for answer mini-loop and interview session.
 *
 * Fixed product policy (ADR-0013 amendment):
 *   1. System probes (deterministic) — first applicable proposal that clears dispose wins;
 *      a probe that does not apply (null) is a no-op and does not block later stages.
 *   2. Gap detection LLM — only if no system probe won.
 *   3. Deepen LLM — only if gap omitted or selected nothing.
 *
 * Dispose remains `decideFollowUp`. Distress / off-ramp short-circuits before any LLM stage
 * (and before probes) so we never spend a call or propose into pain.
 */
import {
  decideFollowUp,
  type FollowUpDecision,
  type FollowUpDecisionInput,
} from "./behavior";
import type {
  FollowUpEvaluation,
  FollowUpEvaluationInput,
  FollowUpEvaluator,
} from "./contracts";
import { FOLLOW_UP_TYPE_TO_GAP_KIND } from "./follow-up-mapping";
import type { GapKind } from "./gap-detection";
import type {
  SystemFollowUpProbe,
  SystemFollowUpProbeContext,
} from "./system-follow-up-probe";

export type FollowUpOrigin = "system" | "gap" | "reflection";
export type FollowUpCascadeStage = "system" | "gap" | "deepen" | "none";

export interface ProposeAndDisposeFollowUpInput {
  /** Deterministic probes; run in order until one yields a selected candidate. */
  probes?: ReadonlyArray<SystemFollowUpProbe>;
  /** Context passed to every probe (dating latch lives here). */
  probeContext?: SystemFollowUpProbeContext;
  /** Gap-detection evaluator; omitted → skip gap stage. */
  gapEvaluator?: FollowUpEvaluator;
  /** Free-form deepen evaluator; omitted → skip deepen stage. */
  deepenEvaluator?: FollowUpEvaluator;
  /** Shared dispose inputs (evaluation is supplied per stage by this function). */
  decide: Omit<FollowUpDecisionInput, "evaluation">;
  /** Shared evaluate inputs for LLM stages. */
  evaluationInput: FollowUpEvaluationInput;
}

export interface ProposeAndDisposeFollowUpResult {
  decision: FollowUpDecision;
  /** Evaluation from the stage that produced the decision (empty candidates on early short-circuit). */
  evaluation: FollowUpEvaluation;
  /** Cascade stage that produced the decision. */
  stage: FollowUpCascadeStage;
  /** Origin for phrasing when a candidate was selected; null when none. */
  origin: FollowUpOrigin | null;
  /** Phraser gap angle when selected from system/gap (or reverse-mapped from deepen type). */
  gapKind?: GapKind;
}

const EMPTY_EVAL: FollowUpEvaluation = { candidates: [], modelId: "cascade:skipped" };

/**
 * Run the probe → gap → deepen cascade and dispose once. Never throws for empty stages —
 * evaluator failures propagate to the caller (surfaces wrap best-effort).
 */
export async function proposeAndDisposeFollowUp(
  input: ProposeAndDisposeFollowUpInput,
): Promise<ProposeAndDisposeFollowUpResult> {
  const { decide, evaluationInput } = input;

  // Distress / off-ramp: short-circuit before probes and LLM stages (matches interview session).
  if (decide.distressed || decide.offRampRequested) {
    const evaluation = EMPTY_EVAL;
    const decision = decideFollowUp({ ...decide, evaluation });
    return { decision, evaluation, stage: "none", origin: null };
  }

  // 1. System probes
  for (const probe of input.probes ?? []) {
    const proposal = probe.maybePropose(
      input.probeContext ?? { answerTranscript: evaluationInput.answerTranscript },
    );
    if (!proposal) continue;
    const evaluation: FollowUpEvaluation = {
      candidates: [proposal.candidate],
      modelId: proposal.modelId,
    };
    const decision = decideFollowUp({ ...decide, evaluation });
    if (decision.selected) {
      return {
        decision,
        evaluation,
        stage: "system",
        origin: "system",
        gapKind: proposal.gapKind,
      };
    }
    // Probe proposed but dispose rejected — try next probe (do not block later stages).
  }

  // 2. Gap detection
  let lastNone: ProposeAndDisposeFollowUpResult | null = null;
  if (input.gapEvaluator) {
    const evaluation = await input.gapEvaluator.evaluate(evaluationInput);
    const decision = decideFollowUp({ ...decide, evaluation });
    if (decision.selected) {
      return {
        decision,
        evaluation,
        stage: "gap",
        origin: "gap",
        gapKind: FOLLOW_UP_TYPE_TO_GAP_KIND[decision.selected.type],
      };
    }
    lastNone = { decision, evaluation, stage: "gap", origin: null };
  }

  // 3. Deepen
  if (input.deepenEvaluator) {
    const evaluation = await input.deepenEvaluator.evaluate(evaluationInput);
    const decision = decideFollowUp({ ...decide, evaluation });
    if (decision.selected) {
      return {
        decision,
        evaluation,
        stage: "deepen",
        origin: "reflection",
        gapKind: FOLLOW_UP_TYPE_TO_GAP_KIND[decision.selected.type],
      };
    }
    return { decision, evaluation, stage: "deepen", origin: null };
  }

  if (lastNone) return lastNone;

  const evaluation = EMPTY_EVAL;
  const decision = decideFollowUp({ ...decide, evaluation });
  return { decision, evaluation, stage: "none", origin: null };
}
