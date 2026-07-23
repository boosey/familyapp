/**
 * Resolve the FollowUpPolicy for a request. Follow-ups now run for EVERY story — typed or voice,
 * self-initiated or answering an Ask — so `enabled` defaults to TRUE. This is still the ONE place a
 * per-narrator opt-out (#351) will later inject a `Partial<FollowUpPolicy>` with `enabled:false`.
 * The `FOLLOW_UPS_ENABLED` env var is no longer the feature switch — it survives only as an
 * EMERGENCY GLOBAL KILL SWITCH (set it to "0"/"false" to dark the cascade everywhere at once).
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
  // ON for everyone by default. The env var is only an emergency kill switch: exactly "0" or
  // "false" (case-insensitive) darks the cascade globally; anything else — including unset —
  // leaves follow-ups enabled.
  const kill = process.env.FOLLOW_UPS_ENABLED?.trim().toLowerCase();
  const enabled = !(kill === "0" || kill === "false");
  return resolveFollowUpPolicy({ enabled });
}
