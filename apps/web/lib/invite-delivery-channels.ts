/**
 * Pure decision: which delivery channels a member-invite send action requests (issue #118).
 * Extracted so it is directly unit-testable (no `server-only`, no DB) — see
 * `__tests__/invite-delivery-channels.test.ts`.
 *
 * The invite form has THREE actions:
 *  - "Send to email"  → ['email']  (requires an email — a mismatched click is a form error)
 *  - "Send to phone"  → ['sms']    (requires a normalized phone AND an unchecked-by-default SMS
 *                                    consent checkbox — Twilio TFV / TCPA express consent)
 *  - "Get link"       → []         (delivers nothing; the inviter hand-shares the durable link)
 * Every action — including "Get link" — still requires ≥1 identifier (email or phone), enforced
 * by the caller before planning: identifiers power dedup (#117) and reconciliation (#120).
 */
import type { DeliveryChannel } from "@chronicle/notifications";

export type InviteSendIntent = "send_email" | "send_phone" | "get_link";

/**
 * Parse the submitted intent, defaulting to the safest action. An unknown/missing value (crafted
 * POST, old form) becomes "get_link" — it delivers NOTHING, so a malformed submit can never
 * trigger an unexpected email/SMS.
 */
export function parseInviteIntent(raw: string): InviteSendIntent {
  if (raw === "send_email" || raw === "send_phone") return raw;
  return "get_link";
}

/** Checkbox `name="smsConsent"` — unchecked boxes omit the field entirely. */
export function parseSmsConsent(raw: FormDataEntryValue | null): boolean {
  return raw === "on" || raw === "true" || raw === "1";
}

export type InviteChannelPlan =
  | { ok: true; channels: DeliveryChannel[] }
  | { ok: false; reason: "email_required" | "phone_required" | "sms_consent_required" };

/** Resolve the channels for an intent, refusing a send action its required contact is missing. */
export function planInviteChannels(
  intent: InviteSendIntent,
  input: {
    email: string | null;
    normalizedPhone: string | null;
    /** Required when intent is send_phone; ignored otherwise. */
    smsConsent?: boolean;
  },
): InviteChannelPlan {
  if (intent === "send_email") {
    return input.email && input.email.trim()
      ? { ok: true, channels: ["email"] }
      : { ok: false, reason: "email_required" };
  }
  if (intent === "send_phone") {
    if (!input.normalizedPhone) return { ok: false, reason: "phone_required" };
    if (!input.smsConsent) return { ok: false, reason: "sms_consent_required" };
    return { ok: true, channels: ["sms"] };
  }
  return { ok: true, channels: [] };
}

/** Map a channel-plan failure to hub.invite copy (shared by cold + person-bound invite paths). */
export function inviteChannelPlanErrorMessage(
  reason: Exclude<InviteChannelPlan, { ok: true }>["reason"],
  copy: {
    emailRequired: string;
    phoneRequired: string;
    smsConsentRequired: string;
  },
): string {
  if (reason === "email_required") return copy.emailRequired;
  if (reason === "phone_required") return copy.phoneRequired;
  return copy.smsConsentRequired;
}
