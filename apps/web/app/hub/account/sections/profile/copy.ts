/**
 * Account › Profile — section-level copy (ADR-0029). Section-specific strings live HERE, never a
 * shared copy module. The identity/anchor FIELD strings the form renders still come from the shared
 * `hub`/`welcome`/`common` copy (unchanged from the old /hub/profile surface); only the panel's own
 * heading/subtitle are section-owned.
 */
export const profileSectionCopy = {
  title: "Your profile",
  subtitle: "Changes save automatically when you leave each field.",
} as const;
