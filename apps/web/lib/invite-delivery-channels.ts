/**
 * Pure decision: which delivery channels to request for a member invite, given the raw form
 * inputs already normalized by the caller. Extracted so it is directly unit-testable (no
 * `server-only`, no DB) — see `__tests__/invite-delivery-channels.test.ts`.
 *
 * Rules:
 *  - `email` iff a non-empty (post-trim) email was supplied.
 *  - `sms` iff a normalized phone was supplied AND the invitee (inviter, on their behalf) gave
 *    SMS consent. A phone without consent never triggers an SMS send.
 */
import type { DeliveryChannel } from "@chronicle/notifications";

export function resolveInviteChannels(input: {
  email: string | null;
  normalizedPhone: string | null;
  smsConsent: boolean;
}): DeliveryChannel[] {
  const channels: DeliveryChannel[] = [];
  if (input.email && input.email.trim()) channels.push("email");
  if (input.normalizedPhone && input.smsConsent) channels.push("sms");
  return channels;
}
