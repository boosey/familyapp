/**
 * Shared renderer for a legal document (Privacy Policy, Terms and Conditions).
 *
 * Both documents live as structured data in `app/_copy/legal.ts` (heading + ordered
 * blocks) so their pages stay thin and a later next-intl migration can serialize them.
 * This component is the one place that turns that shape into markup — keep it
 * presentational and free of document-specific copy.
 */
import Link from "next/link";
import type { LegalSection } from "@/app/_copy/legal";

export interface LegalDocumentData {
  readonly title: string;
  readonly effectiveDate: string;
  readonly lastUpdated: string;
  readonly intro: readonly string[];
  readonly sections: readonly LegalSection[];
}

export function LegalDocument({
  doc,
  appName,
}: {
  doc: LegalDocumentData;
  appName: string;
}) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--surface-page)",
        padding: "6vh 6vw",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <article
        style={{
          width: "100%",
          maxWidth: "68ch",
          fontFamily: "var(--font-ui)",
          color: "var(--text-body)",
          lineHeight: "var(--leading-body)",
        }}
      >
        <header style={{ marginBottom: 32 }}>
          <div className="kin-eyebrow">{appName}</div>
          <h1
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-display)",
              letterSpacing: "var(--tracking-tight)",
              lineHeight: "var(--leading-tight)",
              margin: "8px 0 12px",
            }}
          >
            {doc.title}
          </h1>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              letterSpacing: "var(--tracking-mono)",
              color: "var(--support)",
              margin: 0,
            }}
          >
            Last updated {doc.lastUpdated} · Effective {doc.effectiveDate}
          </p>
        </header>

        {doc.intro.map((para, i) => (
          <p key={`intro-${i}`} style={{ margin: "0 0 16px", color: "var(--text-muted)" }}>
            {para}
          </p>
        ))}

        {doc.sections.map((section) => (
          <section key={section.id} id={section.id} style={{ marginTop: 32 }}>
            <h2
              style={{
                fontFamily: "var(--font-story)",
                fontSize: "var(--text-heading, 1.5rem)",
                lineHeight: "var(--leading-tight)",
                margin: "0 0 12px",
              }}
            >
              {section.heading}
            </h2>
            {section.blocks.map((block, i) =>
              "p" in block ? (
                <p key={i} style={{ margin: "0 0 14px", color: "var(--text-muted)" }}>
                  {block.p}
                </p>
              ) : (
                <ul
                  key={i}
                  style={{
                    margin: "0 0 14px",
                    paddingLeft: 22,
                    color: "var(--text-muted)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {block.list.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}

        <hr className="kin-divider" style={{ margin: "40px 0 20px" }} />
        <p style={{ margin: 0 }}>
          <Link href="/" style={{ color: "var(--support)" }}>
            ← Back to {appName}
          </Link>
        </p>
      </article>
    </main>
  );
}
