"use server";

/**
 * Onboarding server actions — thin adapters. Each re-resolves the auth context server-side (the
 * client never passes a personId) and delegates the actual write + validation to `@chronicle/core`,
 * which owns the date-of-birth validation and the `onboarded_at` state transition. The web layer's
 * only job here is to turn the request into an authenticated personId and call the domain.
 */
import { completeOnboarding, recordAccountSmsOptIn } from "@chronicle/core";
import { transcribeIntakeAudio, parseSpokenDate, type SpokenDate } from "@chronicle/pipeline";
import { normalizePhone } from "@chronicle/notifications";
import { getRuntime } from "@/lib/runtime";
import { welcome } from "@/app/_copy";

export interface CompleteAccountOnboardingInput {
  displayName: string;
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  /**
   * Optional mobile for SMS. When set with `smsConsent: true`, persisted as the account holder's
   * express SMS opt-in (not an account_contacts match key).
   */
  phone?: string;
  smsConsent?: boolean;
}

export async function completeAccountOnboarding(
  input: CompleteAccountOnboardingInput,
): Promise<void> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");
  await completeOnboarding(db, ctx.personId, input);

  const phoneRaw = input.phone?.trim() ?? "";
  if (!phoneRaw) return;

  if (!input.smsConsent) {
    throw new Error(welcome.smsConsentRequired);
  }
  const normalized = normalizePhone(phoneRaw);
  if (!normalized) {
    throw new Error(welcome.phoneInvalid);
  }
  await recordAccountSmsOptIn(db, ctx.personId, { phone: normalized });
}

/**
 * Read the audio blob off a FormData onboarding-voice submission, or throw the same "must be signed
 * in" / shape errors both voice actions share. These clips are throwaway form-fill helpers — unlike
 * the intake surface, we do NOT persist the audio: name and DOB are stored as structured profile
 * fields (via completeAccountOnboarding), not as content recordings.
 */
async function readOnboardingAudio(
  formData: FormData,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const audio = formData.get("audio");
  if (!(audio instanceof Blob)) throw new Error("no audio");
  const bytes = new Uint8Array(await audio.arrayBuffer());
  return { bytes, contentType: audio.type || "audio/webm" };
}

/**
 * Name step voice control: transcribe the clip and return a lightly-cleaned name to seed the field.
 * The typed path is always available; voice just pre-fills. Best-effort — a transcription failure
 * returns an empty string (the user types into the box), never a 500.
 */
export async function transcribeOnboardingName(
  formData: FormData,
): Promise<{ name: string }> {
  const { auth, transcriber } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");

  try {
    const audio = await readOnboardingAudio(formData);
    const { text } = await transcribeIntakeAudio(transcriber, audio);
    return { name: cleanSpokenName(text) };
  } catch {
    return { name: "" };
  }
}

/**
 * DOB step voice control: transcribe the clip, then LLM-parse the spoken date into {year, month, day}
 * to pre-fill the three dropdowns. Conservative — any field the speaker didn't clearly state comes
 * back null and the dropdown stays empty for the user to pick. Best-effort: a failure returns all
 * nulls (the user works the dropdowns), never a 500.
 */
export async function transcribeOnboardingDob(
  formData: FormData,
): Promise<SpokenDate> {
  const { auth, transcriber, languageModel } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") throw new Error("must be signed in");

  try {
    const audio = await readOnboardingAudio(formData);
    const { text } = await transcribeIntakeAudio(transcriber, audio);
    return await parseSpokenDate(languageModel, text);
  } catch {
    return { year: null, month: null, day: null };
  }
}

/**
 * Light cleanup of a spoken name: collapse whitespace and strip trailing sentence punctuation a
 * transcriber tends to append ("Alex Boudreaux." -> "Alex Boudreaux"). Deliberately does NOT try to
 * strip lead-ins like "my name is" — that risks eating a real name; the user sees the field and edits.
 */
function cleanSpokenName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").replace(/[.,!?;:]+$/, "").trim();
}
