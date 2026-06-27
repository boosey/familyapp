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
        background: "var(--surface-card)",
        border: "var(--border-width, 1.5px) solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "24px 28px",
        boxShadow: "var(--shadow-sm)",
        ...style,
      }}
      {...rest}
    >
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
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent)",
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
          }}
        >
          {question}
        </div>
      ) : null}
      {children}
    </div>
  );
}
