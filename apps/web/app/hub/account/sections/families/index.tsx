/**
 * Account › Families (ADR-0029) — the PERSONAL membership slice, consolidated from the old avatar menu
 * (the stewarded-families query removed from `load-account-menu.ts` re-lands here). Shows:
 *   - ONE list of every family the viewer holds an ACTIVE membership in, with their role in each; a
 *     family the viewer stewards additionally shows an inline icon-link out to `/families/{id}/edit`
 *     (folded in from a separate second "Families you steward" list — every stewarded family is also
 *     a family the viewer belongs to, so the split list was redundant), and
 *   - "Create a family" (`/families/new`) / "Find a family" (`/families/find`).
 *
 * Scope is deliberately narrow. Family GOVERNANCE (member management, tree, album) is NOT absorbed —
 * it stays on the per-family surface, reached via the steward link-out. Per-viewer short-name override
 * and self leave/pause are OMITTED: CONTEXT.md § Short name marks the override a future account-level
 * preference (no backend), and there is no self-leave write path — surface only what has a real backend.
 */
import type { CSSProperties } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import {
  listActiveFamiliesForPerson,
  listActiveMembershipsForPerson,
  listFamiliesStewardedBy,
} from "@chronicle/core";
import type { MembershipRole } from "@chronicle/db";
import type { AccountSectionProps } from "../../section-props";
import { familiesSectionCopy as copy } from "./copy";

interface MembershipRow {
  familyId: string;
  /** Short name (ADR-0021) when the steward set one, else the formal name. */
  name: string;
  role: MembershipRole;
}

export default async function FamiliesSection({ personId, db }: AccountSectionProps) {
  // Two reads, joined in memory by familyId: the active-family view carries names + short names, the
  // membership view carries the viewer's DB role in each. Both key off (person, family, status=active),
  // so every active family has exactly one matching membership row.
  const [families, memberships, stewarded] = await Promise.all([
    listActiveFamiliesForPerson(db, personId),
    listActiveMembershipsForPerson(db, personId),
    listFamiliesStewardedBy(db, personId),
  ]);

  const roleByFamily = new Map<string, MembershipRole>(
    memberships.map((m) => [m.familyId, m.role]),
  );
  const stewardedIds = new Set<string>(stewarded.map((f) => f.familyId));

  const rows: MembershipRow[] = families.map((f) => ({
    familyId: f.familyId,
    name: f.familyShortName ?? f.familyName,
    role: roleByFamily.get(f.familyId) ?? "member",
  }));

  return (
    <section aria-labelledby="account-section-title">
      <h2 id="account-section-title" style={titleStyle}>
        {copy.title}
      </h2>

      {rows.length === 0 ? (
        <p style={emptyStyle}>{copy.empty}</p>
      ) : (
        <ul style={listStyle}>
          {rows.map((row) => (
            <li key={row.familyId} style={memberRowStyle}>
              <span style={familyNameStyle}>{row.name}</span>
              <span style={rowMetaStyle}>
                <span style={roleBadgeStyle}>{copy.roleLabel[row.role]}</span>
                {stewardedIds.has(row.familyId) ? (
                  <Link
                    href={`/families/${row.familyId}/edit`}
                    style={iconLinkStyle}
                    aria-label={copy.familySettingsLink}
                    title={copy.familySettingsLink}
                  >
                    <Settings2 size={18} strokeWidth={2} aria-hidden />
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div style={blockStyle}>
        <h3 style={headingStyle}>{copy.actionsHeading}</h3>
        <div style={actionRowStyle}>
          <Link href="/families/new" style={buttonLinkStyle}>
            {copy.createFamily}
          </Link>
          <Link href="/families/find" style={buttonLinkStyle}>
            {copy.findFamily}
          </Link>
        </div>
      </div>
    </section>
  );
}

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-story)",
  fontSize: "clamp(1.5rem, 3.5vw, var(--text-display))",
  fontWeight: 400,
  color: "var(--text-body)",
  margin: "0 0 8px",
};

const emptyStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
  margin: 0,
};

const listStyle: CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const memberRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "12px 14px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--surface-card)",
};

const familyNameStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui)",
  color: "var(--text-body)",
};

const roleBadgeStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
};

const rowMetaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
};

const iconLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-muted)",
  padding: "4px",
  borderRadius: "var(--radius-sm)",
};

const blockStyle: CSSProperties = {
  marginTop: "32px",
};

const headingStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui)",
  fontWeight: 600,
  color: "var(--text-body)",
  margin: "0 0 4px",
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
};

const buttonLinkStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-body)",
  textDecoration: "none",
  padding: "10px 16px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--surface-card)",
};
