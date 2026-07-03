"use server";

/**
 * Onboarding server actions — thin adapters. Each re-resolves the auth context server-side (the
 * client never passes a personId) and delegates the actual write + validation to `@chronicle/core`,
 * which owns the date-of-birth validation and the `onboarded_at` state transition. The web layer's
 * only job here is to turn the request into an authenticated personId and call the domain.
 */
import { completeOnboarding } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";

export interface CompleteAccountOnboardingInput {
  displayName: string;
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export async function completeAccountOnboarding(
  input: CompleteAccountOnboardingInput,
): Promise<void> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");
  await completeOnboarding(db, ctx.personId, input);
}
