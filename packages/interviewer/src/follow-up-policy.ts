/**
 * FollowUpPolicy DEFAULT + resolver. The TYPE lives in `@chronicle/db` (persisted); the default
 * values and resolution logic live here. This is a RESOLVED OBJECT, never hardcoded constants
 * scattered through the loop (the user was emphatic): resolved once at session start and
 * subscription-ready — a future tier maps to a `Partial<FollowUpPolicy>` overrides bag.
 *
 * `enabled` defaults to FALSE so the feature lands dark. `decideFollowUp` (behavior.ts) applies the
 * caps + thresholds over the evaluator's proposed candidates.
 */
import type { FollowUpPolicy } from "@chronicle/db";

export type { FollowUpPolicy };

export const DEFAULT_FOLLOW_UP_POLICY: FollowUpPolicy = {
  enabled: false,
  maxFollowUpsPerThread: 2,
  maxFollowUpsPerSession: 4,
  thinAnswerWordFloor: 8,
  confidenceThreshold: 0.6,
};

export function resolveFollowUpPolicy(overrides?: Partial<FollowUpPolicy>): FollowUpPolicy {
  return { ...DEFAULT_FOLLOW_UP_POLICY, ...overrides };
}
