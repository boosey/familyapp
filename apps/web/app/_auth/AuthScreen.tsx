/**
 * Shared chrome for the auth screens (sign-up / sign-in). Presentational only — no
 * state, no client boundary — so server components can compose it directly with their server-action
 * forms inside.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { common } from "@/app/_copy";

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
      className="spark-atmosphere"
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(24px, 5vw, 48px) 16px",
      }}
    >
      <div
        className="spark-rise"
        style={{
          maxWidth: 460,
          width: "100%",
          padding: "clamp(28px, 5vw, 48px)",
          background: "color-mix(in srgb, var(--surface-card) 92%, transparent)",
          border: "var(--border-width) solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-lift)",
          backdropFilter: "blur(12px)",
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "1.15rem",
            fontWeight: 600,
            letterSpacing: "var(--tracking-tight)",
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          {common.authScreenBrand}
        </Link>
        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-display)",
            fontWeight: 550,
            color: "var(--text-body)",
            margin: "16px 0 8px",
            lineHeight: "var(--leading-tight)",
            letterSpacing: "var(--tracking-display)",
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
