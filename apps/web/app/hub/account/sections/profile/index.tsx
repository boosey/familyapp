/**
 * Account › Profile (ADR-0029) — the Person's identity + biographical-anchor editor, relocated from
 * the old /hub/profile surface. Fields auto-save on blur (booleans on change); email is read-only from
 * the linked Account. First-time intake still lives at /hub/about-you — this is for later edits.
 *
 * Owns its own data load (keyed on the shared-contract `personId`/`db`) and reuses the relocated
 * `ProfileForm` client component + its server actions (colocated in this folder). Section-level copy
 * is in `./copy.ts`; the identity/anchor field strings stay on the shared copy the form imports.
 */
import type { CSSProperties } from "react";
import { eq } from "drizzle-orm";
import type { BiographicalProfile } from "@chronicle/db";
import { accounts, persons } from "@chronicle/db/schema";
import { notFound } from "next/navigation";
import type { AccountSectionProps } from "../../section-props";
import { ProfileForm } from "./ProfileForm";
import { profileSectionCopy } from "./copy";

export default async function ProfileSection({ personId, db }: AccountSectionProps) {
  const [row] = await db
    .select({
      displayName: persons.displayName,
      spokenName: persons.spokenName,
      birthDate: persons.birthDate,
      biographicalAnchors: persons.biographicalAnchors,
      sex: persons.sex,
      email: accounts.email,
    })
    .from(persons)
    .leftJoin(accounts, eq(persons.accountId, accounts.id))
    .where(eq(persons.id, personId))
    .limit(1);

  if (!row) notFound();

  const anchors = (row.biographicalAnchors ?? {}) as Partial<BiographicalProfile>;

  return (
    <section aria-labelledby="account-profile-title">
      <header style={headerStyle}>
        <h2 id="account-profile-title" style={title}>
          {profileSectionCopy.title}
        </h2>
        <p style={subtitle}>{profileSectionCopy.subtitle}</p>
      </header>

      <ProfileForm
        displayName={row.displayName ?? ""}
        spokenName={row.spokenName ?? ""}
        email={row.email}
        birthDate={row.birthDate}
        sex={row.sex ?? "unknown"}
        anchors={anchors}
      />
    </section>
  );
}

const headerStyle: CSSProperties = {
  marginBottom: 32,
};

const title: CSSProperties = {
  fontFamily: "var(--font-story)",
  fontSize: "clamp(1.5rem, 3.5vw, var(--text-display))",
  fontWeight: 400,
  color: "var(--text-body)",
  margin: "0 0 8px",
};

const subtitle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
  margin: 0,
  lineHeight: "var(--leading-snug)",
};
