/**
 * Root landing — the account-holder front door. A login-free link-session visitor NEVER lands here;
 * they only ever follow their personal /s/[token] capture link. This is the warm marketing-light
 * entry for relatives: name the product, then offer the two real doors (create a family, or sign
 * in to an existing one).
 */
import Link from "next/link";
import { KindredButton } from "@/app/_kindred";
import { common, auth } from "@/app/_copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-page)",
        padding: "6vh 6vw",
        gap: 18,
        textAlign: "center",
      }}
    >
      <div className="kin-eyebrow">{auth.landing.eyebrow}</div>
      <h1
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-display-lg)",
          letterSpacing: "var(--tracking-tight)",
          color: "var(--text-body)",
          margin: 0,
          lineHeight: "var(--leading-tight)",
        }}
      >
        {common.appName}
      </h1>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-muted)",
          maxWidth: "34ch",
          margin: 0,
          lineHeight: "var(--leading-body)",
        }}
      >
        {auth.landing.tagline}
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          justifyContent: "center",
          marginTop: 12,
        }}
      >
        <Link href="/sign-up" style={{ textDecoration: "none" }}>
          <KindredButton label={auth.landing.createFamily} size="large" />
        </Link>
        <Link href="/sign-in" style={{ textDecoration: "none" }}>
          <KindredButton label={auth.landing.signIn} variant="secondary" size="large" />
        </Link>
      </div>

      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-label)",
          letterSpacing: "var(--tracking-mono)",
          color: "var(--support)",
          margin: "8px 0 0",
        }}
      >
        {auth.landing.narratorNote}
      </p>
    </main>
  );
}
