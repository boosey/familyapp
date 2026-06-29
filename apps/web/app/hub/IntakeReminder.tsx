/**
 * Hub intake reminder — a banner shown at the top of the hub until the narrator's biographical
 * profile is complete. Presentational server component (no client state): it renders a short
 * nudge plus a link into the introduction flow where the missing facts are collected.
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
        display: "flex",
        alignItems: "center",
        gap: 20,
        flexWrap: "wrap",
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
          flex: 1,
          minWidth: 0,
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
        href="/welcome"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 22px",
          borderRadius: "var(--radius-md)",
          background: "var(--accent)",
          color: "var(--accent-on)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          fontWeight: 600,
          whiteSpace: "nowrap",
          textDecoration: "none",
        }}
      >
        {hub.intake.cta}
      </Link>
    </div>
  );
}
