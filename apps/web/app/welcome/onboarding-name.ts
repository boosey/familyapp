/**
 * Pre-fill for the /welcome name field.
 *
 * When manual Clerk sign-up collects only email + password, JIT provisioning has no real name and
 * `clerkDisplayName` falls back to the email local-part ("alexboudreaux.dev"). We must NOT invite
 * the user to simply confirm that prefix as their name. So: if the stored displayName looks like the
 * email-prefix fallback (case-insensitive, trimmed match against the local-part), return "" — the
 * name field starts blank and Continue stays disabled until they type a real name. Otherwise the
 * displayName is a real Clerk name and we pre-fill it for one-tap confirmation.
 */
export function initialOnboardingName(displayName: string, email: string): string {
  const localPart = email.split("@")[0]?.trim().toLowerCase() ?? "";
  if (localPart.length > 0 && displayName.trim().toLowerCase() === localPart) {
    return "";
  }
  return displayName;
}
