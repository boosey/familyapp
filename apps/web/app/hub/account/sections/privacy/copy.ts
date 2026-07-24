/**
 * Account › Privacy — section-level copy (ADR-0029 §#331). Section-specific strings live HERE, never a
 * shared copy module. Contact visibility: two independent, account-level booleans (hide email, hide
 * phone). Hidden = suppressed from every co-member-facing contact read (including the Steward) and from
 * Invite-modal prefill; it NEVER disables system notification delivery. Default = visible.
 */
export const privacySectionCopy = {
  title: "Privacy",
  subtitle: "Choose what other family members can see. Changes save automatically.",

  contactHeading: "Contact visibility",
  contactIntro:
    "By default, other members of your families can see your email and phone, and the app uses them to prefill invitations. Hiding a channel keeps it off those screens — but the app can still email or text you. Delivery of your own notifications is never affected.",

  hideEmailLabel: "Hide my email from family members",
  hideEmailHelp:
    "Other members won't see your email and it won't prefill invitations. You'll still receive email notifications you've asked for.",

  hidePhoneLabel: "Hide my phone from family members",
  hidePhoneHelp:
    "Other members won't see your phone and it won't prefill invitations. You'll still receive text notifications you've asked for.",

  saving: "Saving…",
  saved: "Saved",
  saveError: "Couldn't save — try again.",
} as const;
