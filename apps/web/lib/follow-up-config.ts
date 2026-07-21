/**
 * Resolve the FollowUpPolicy for a request. v1: a single env flag (mirrors the isXConfigured()
 * idiom); the ONE place a subscription tier will later inject Partial<FollowUpPolicy> overrides.
 * Off by default so the feature lands dark.
 */
import { resolveFollowUpPolicy, type FollowUpPolicy } from "@chronicle/interviewer";

/**
 * Latency budget for the follow-up tax (cascade evaluate + phrase). Exceed → degrade to one-shot:
 * the narrator's take is already transcribed regardless, so this bounds only the EXTRA follow-up
 * work. A broken/slow evaluator can never block sharing (handoff watch #2).
 *
 * Sized for the Option-3 two-stage path: gap evaluate + deepen evaluate + phraseIntent. The prior
 * 8s budget was enough for deepen-only; 16s leaves ~5s/stage plus phrasing headroom without
 * stretching the narrator-facing pause unreasonably.
 *
 * Lives here (not in a `"use server"` actions file) so Next.js can compile the module — server
 * action files may only export async functions.
 */
export const FOLLOW_UP_BUDGET_MS = 16_000;

export function resolveFollowUpPolicyForRequest(): FollowUpPolicy {
  const enabled = process.env.FOLLOW_UPS_ENABLED === "1" || process.env.FOLLOW_UPS_ENABLED === "true";
  return resolveFollowUpPolicy({ enabled });
}
