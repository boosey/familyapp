import type { HTMLAttributes, ReactNode } from "react";

export interface KindredPromptCardProps extends HTMLAttributes<HTMLDivElement> {
  eyebrow?: string;
  question?: ReactNode;
  children?: ReactNode;
}

/** A family member's question — serif lead, flat panel, no decorative orbs. */
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
        border: "var(--border-width, 2px) solid var(--border-strong)",
        borderLeft: "6px solid var(--accent)",
        borderRadius: "var(--radius-md)",
        padding: "24px 26px",
        boxShadow: "none",
        ...style,
      }}
      {...rest}
    >
      {eyebrow ? (
        <div
          style={{
            fontSize: "var(--text-label)",
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
            letterSpacing: "0.06em",
            color: "var(--text-meta)",
            marginBottom: 12,
            textTransform: "uppercase",
          }}
        >
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
          }}
        >
          {question}
        </div>
      ) : null}
      {children}
    </div>
  );
}
