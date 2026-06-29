/**
 * Hub intake reminder — a banner shown at the top of the hub until the narrator's biographical
 * profile is complete. Presentational server component (no client state): a short informational
 * note. There is intentionally no call-to-action — no hub→intake-session route exists yet, so the
 * banner only signals that more of their introduction remains.
 */
import type { BiographicalProfile } from "@chronicle/db";
import { hub } from "@/app/_copy";

interface Props {
  profile: Partial<BiographicalProfile>;
}

/** Required for "complete": the four free-text facts + whether they have children.
 *  hasGrandchildren is conditional and never required. */
function isProfileComplete(p: Partial<BiographicalProfile>): boolean {
  return (
    p.hometown != null &&
    p.siblingContext != null &&
    p.currentLocation != null &&
    p.occupationSummary != null &&
    p.hasChildren != null
  );
}

export function IntakeReminder({ profile }: Props) {
  if (isProfileComplete(profile)) return null;
  return (
    <div
      role="status"
      aria-label={hub.intake.aria}
      style={{
        marginBottom: 28,
        background: "var(--surface-card)",
        border: "var(--border-width) solid var(--accent)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-card)",
        padding: "20px 24px",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story)",
          lineHeight: "var(--leading-snug)",
          color: "var(--text-body)",
          margin: 0,
        }}
      >
        {hub.intake.body}
      </p>
    </div>
  );
}
