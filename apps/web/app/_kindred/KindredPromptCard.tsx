import type { HTMLAttributes, ReactNode } from "react";

export interface KindredPromptCardProps extends HTMLAttributes<HTMLDivElement> {
  eyebrow?: string;
  /** Accepts a string or any renderable node; serialized-string callers and JSX callers both compile. */
  question?: ReactNode;
  children?: ReactNode;
}

/** A family member's question, set in serif — the seed of every conversation. */
export function KindredPromptCard({
  eyebrow,
  question,
  children,
  style,
  ...rest
}: KindredPromptCardProps) {
  return (
    <div
      style={{
        background:
          "linear-gradient(160deg, var(--surface-card) 0%, color-mix(in srgb, var(--accent-soft) 55%, var(--surface-card)) 100%)",
        border: "var(--border-width, 1.5px) solid var(--border)",
        borderRadius: "var(--radius-xl)",
        padding: "28px 30px",
        boxShadow: "var(--shadow-card)",
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -30,
          right: -20,
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: "color-mix(in srgb, var(--support) 18%, transparent)",
        }}
      />
      {eyebrow ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "var(--text-label)",
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
            letterSpacing: "0.06em",
            color: "var(--accent)",
            marginBottom: 14,
            position: "relative",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "var(--radius-sm)",
              background: "linear-gradient(135deg, var(--accent), var(--support))",
              flexShrink: 0,
            }}
          />
          {eyebrow}
        </div>
      ) : null}
      {question != null ? (
        <div
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-prompt)",
            lineHeight: "var(--leading-snug)",
            color: "var(--text-body)",
            letterSpacing: "var(--tracking-tight)",
            position: "relative",
          }}
        >
          {question}
        </div>
      ) : null}
      {children}
    </div>
  );
}
