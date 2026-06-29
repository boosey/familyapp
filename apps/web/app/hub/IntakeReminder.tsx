/**
 * Hub intake reminder — a banner shown at the top of the hub until the narrator's biographical
 * profile is complete. Presentational server component (no client state). Its call-to-action links
 * to /hub/about-you (the single intake surface), so the narrator can pick up their introduction.
 */
import Link from "next/link";
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
      <Link
        href="/hub/about-you"
        style={{
          display: "inline-block",
          marginTop: 14,
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          fontWeight: 600,
          color: "var(--accent-strong)",
          textDecoration: "none",
        }}
      >
        {hub.intake.cta}
      </Link>
    </div>
  );
}
