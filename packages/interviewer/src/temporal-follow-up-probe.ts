/**
 * Temporal dating system probe (issue #244 / story-dates) — deterministic "about when was
 * that" when the telling so far yields no Story date. Rides ADR-0013 dispose gates unchanged;
 * the at-most-once latch is owned by the caller via `ctx.dating.alreadyAsked`.
 *
 * Lifted from feat/story-dates `proposeTemporalFollowUp` into this seam so landing PR #249
 * only wires dating context — it must NOT reintroduce an inline special case in turn-loop.
 */
import type { FollowUpCandidate } from "@chronicle/db";
import {
  GAP_FOLLOW_UP_CANDIDATE_CONFIDENCE,
  STORY_DATE_FOLLOW_UP_SEED,
  SYSTEM_STORY_DATE_MODEL_ID,
} from "./constants";
import type {
  SystemFollowUpProbe,
  SystemFollowUpProbeContext,
  SystemFollowUpProposal,
} from "./system-follow-up-probe";

export const TEMPORAL_PROBE_ID = "temporal";

function temporalCandidate(): FollowUpCandidate {
  return {
    threadSeed: STORY_DATE_FOLLOW_UP_SEED,
    type: "temporal",
    // Low sensitivity so the rapport gate cannot suppress the story's one dating chance.
    sensitivity: "low",
    confidence: GAP_FOLLOW_UP_CANDIDATE_CONFIDENCE,
    narratorOpened: false,
  };
}

/**
 * Create the temporal system probe. Returns null (N/A) when dating context is absent, the
 * date is already resolved, or the latch says we already asked.
 */
export function createTemporalFollowUpProbe(): SystemFollowUpProbe {
  return {
    id: TEMPORAL_PROBE_ID,
    maybePropose(ctx: SystemFollowUpProbeContext): SystemFollowUpProposal | null {
      const dating = ctx.dating;
      if (!dating) return null;
      if (!dating.dateUnresolved) return null;
      if (dating.alreadyAsked) return null;
      return {
        candidate: temporalCandidate(),
        probeId: TEMPORAL_PROBE_ID,
        gapKind: "temporal",
        modelId: SYSTEM_STORY_DATE_MODEL_ID,
      };
    },
  };
}
