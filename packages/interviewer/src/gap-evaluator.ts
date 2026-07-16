/**
 * Gap-backed FollowUpEvaluator (issue #80) — the adapter that lets gap detection ride the EXISTING
 * follow-up machinery instead of a parallel path.
 *
 * It implements the same `FollowUpEvaluator` seam the answer-surface already uses, but sources its
 * candidates from the thin gap-detection pass (`extractGaps`) rather than the free-form thread
 * evaluator. Because the output is the same `FollowUpCandidate[]`, `decideFollowUp` (behavior.ts)
 * applies EVERY gate — thin-answer, distress/off-ramp short-circuit, rapport gate, anti-repeat,
 * confidence floor, per-thread/session caps — to gap follow-ups with zero duplicated policy.
 *
 * This is the seam the turn loop consumes: it never talks to the LLM about gaps directly, it asks a
 * `FollowUpEvaluator` for candidates and hands them to `decideFollowUp`. Swapping this evaluator for
 * the free-form one (or a future blend) is a one-line change with no loop edits.
 */
import type { LanguageModel } from "@chronicle/pipeline";
import type { FollowUpEvaluationInput, FollowUpEvaluation, FollowUpEvaluator } from "./contracts";
import { extractGaps, gapsToFollowUpCandidates } from "./gap-detection";
import type { PromptVendor } from "./prompts/gap-prompts";

export function createGapFollowUpEvaluator(
  llm: LanguageModel,
  promptOpts?: { vendor?: PromptVendor; version?: string },
): FollowUpEvaluator {
  return {
    async evaluate(input: FollowUpEvaluationInput): Promise<FollowUpEvaluation> {
      const res = await extractGaps(
        llm,
        { questionText: input.promptText, answerTranscript: input.answerTranscript },
        promptOpts,
      );
      return { candidates: gapsToFollowUpCandidates(res.gaps), modelId: res.modelId };
    },
  };
}
