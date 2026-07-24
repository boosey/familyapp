/**
 * Account › Privacy (ADR-0029 §#331) — contact visibility. Reads the viewer's own
 * `persons.hideEmail` / `persons.hidePhone` and renders two independent toggles that write them back
 * (`./actions.ts`). Hidden = suppressed from every co-member-facing contact read (including the
 * Steward) and from Invite-modal prefill; system notification delivery is NEVER affected. Default is
 * visible.
 */
import type { CSSProperties } from "react";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import type { AccountSectionProps } from "../../section-props";
import { privacySectionCopy as copy } from "./copy";
import { PrivacyForm } from "./PrivacyForm";

export default async function PrivacySection({ personId, db }: AccountSectionProps) {
  const [row] = await db
    .select({ hideEmail: persons.hideEmail, hidePhone: persons.hidePhone })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);

  const hideEmail = row?.hideEmail ?? false;
  const hidePhone = row?.hidePhone ?? false;

  return (
    <section aria-labelledby="account-privacy-title">
      <h2 id="account-privacy-title" style={title}>
        {copy.title}
      </h2>
      <p style={subtitle}>{copy.subtitle}</p>

      <section aria-labelledby="privacy-contact-heading" style={{ marginTop: 32 }}>
        <h3 id="privacy-contact-heading" style={groupHeading}>
          {copy.contactHeading}
        </h3>
        <p style={groupIntro}>{copy.contactIntro}</p>
        <PrivacyForm hideEmail={hideEmail} hidePhone={hidePhone} />
      </section>
    </section>
  );
}

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

const groupHeading: CSSProperties = {
  fontFamily: "var(--font-story)",
  fontSize: "var(--text-story-lg)",
  fontWeight: 400,
  color: "var(--text-body)",
  margin: "0 0 8px",
};

const groupIntro: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
  margin: "0 0 20px",
  lineHeight: "var(--leading-snug)",
};
