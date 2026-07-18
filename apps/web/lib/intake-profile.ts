import type { BiographicalProfile } from "@chronicle/db";

/**
 * Whether the narrator's biographical intake is complete. "Complete" = the four free-text facts plus
 * whether they have children; `hasGrandchildren` is conditional and never required. Extracted here (from
 * the former IntakeReminder banner) so both the server (page.tsx, to decide whether the Stories-tab
 * intake reminder shows) and any future surface share ONE definition of "done" (#138).
 */
export function isBiographicalProfileComplete(p: Partial<BiographicalProfile>): boolean {
  return (
    p.hometown != null &&
    p.siblingContext != null &&
    p.currentLocation != null &&
    p.occupationSummary != null &&
    p.hasChildren != null
  );
}
