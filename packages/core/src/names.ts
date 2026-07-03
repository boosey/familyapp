/**
 * Name derivation — the single definition of the spoken-name rule.
 *
 * `spokenName` (the name the interviewer speaks aloud) defaults to the first whitespace-delimited
 * word of a person's display name. This rule is applied at BOTH identity-write sites — account
 * sign-up (`createAccountWithPerson`) and onboarding (`completeOnboarding`, which re-derives it from
 * the name the user types into /welcome) — so it lives here in one place rather than being copied.
 */

/** First whitespace-delimited word of a display name (the spoken-name default). */
export function defaultSpokenName(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : displayName.trim();
}
