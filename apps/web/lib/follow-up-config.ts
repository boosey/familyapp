/**
 * Resolve the FollowUpPolicy for a request. v1: a single env flag (mirrors the isXConfigured()
 * idiom); the ONE place a subscription tier will later inject Partial<FollowUpPolicy> overrides.
 * Off by default so the feature lands dark.
 */
import { resolveFollowUpPolicy, type FollowUpPolicy } from "@chronicle/interviewer";

export function resolveFollowUpPolicyForRequest(): FollowUpPolicy {
  const enabled = process.env.FOLLOW_UPS_ENABLED === "1" || process.env.FOLLOW_UPS_ENABLED === "true";
  return resolveFollowUpPolicy({ enabled });
}
