/**
 * /privacy — public Privacy Policy.
 *
 * Required for Google OAuth branding/verification of the Google Photos Picker integration
 * (see the "Google User Data" section in `_copy/legal.ts`). This page MUST stay publicly
 * reachable without authentication: Clerk's middleware here is non-blocking (never calls
 * auth.protect()), so this route is not gated — do not add an auth check.
 *
 * Content lives in `app/_copy/legal.ts`; this file is a thin renderer.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { legal, common } from "@/app/_copy";

export const runtime = "nodejs";
// Static legal content — allow full static generation so Google's crawler always gets it fast.
export const dynamic = "force-static";

const { privacy } = legal;

export const metadata: Metadata = {
  title: `${privacy.title} — ${privacy.appName}`,
  description: `How ${privacy.appName} collects, uses, and protects your information, including Google user data.`,
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
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
          <div className="kin-eyebrow">{common.appName}</div>
          <h1
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-display)",
              letterSpacing: "var(--tracking-tight)",
              lineHeight: "var(--leading-tight)",
              margin: "8px 0 12px",
            }}
          >
            {privacy.title}
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
            Last updated {privacy.lastUpdated} · Effective {privacy.effectiveDate}
          </p>
        </header>

        {privacy.intro.map((para, i) => (
          <p key={`intro-${i}`} style={{ margin: "0 0 16px", color: "var(--text-muted)" }}>
            {para}
          </p>
        ))}

        {privacy.sections.map((section) => (
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
            ← Back to {common.appName}
          </Link>
        </p>
      </article>
    </main>
  );
}
