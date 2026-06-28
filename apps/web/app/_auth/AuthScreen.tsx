/**
 * Shared centered-card chrome for the auth screens (sign-up / sign-in). Presentational only — no
 * state, no client boundary — so server components can compose it directly with their server-action
 * forms inside.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export function AuthScreen({
  title,
  subtitle,
  error,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  error?: string | null;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-page)",
        padding: "clamp(24px, 5vw, 48px) 16px",
      }}
    >
      <div
        style={{
          maxWidth: 440,
          width: "100%",
          padding: "clamp(28px, 5vw, 48px)",
          background: "var(--surface-card)",
          border: "var(--border-width) solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-lift)",
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            letterSpacing: "var(--tracking-mono)",
            color: "var(--support)",
            textDecoration: "none",
          }}
        >
          Family Chronicle
        </Link>
        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-display)",
            fontWeight: 500,
            color: "var(--text-body)",
            margin: "14px 0 8px",
            lineHeight: "var(--leading-tight)",
          }}
        >
          {title}
        </h1>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            margin: "0 0 24px",
            lineHeight: "var(--leading-body)",
          }}
        >
          {subtitle}
        </p>

        {error ? (
          <p
            role="alert"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--accent-strong)",
              background: "var(--accent-soft)",
              border: "var(--border-width) solid var(--accent)",
              borderRadius: "var(--radius-md)",
              padding: "12px 16px",
              margin: "0 0 20px",
            }}
          >
            {error}
          </p>
        ) : null}

        {children}

        {footer ? <div style={{ marginTop: 24 }}>{footer}</div> : null}
      </div>
    </main>
  );
}
