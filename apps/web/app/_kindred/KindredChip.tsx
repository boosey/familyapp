import type { CSSProperties, HTMLAttributes } from "react";

export type ChipKind = "person" | "place" | "time" | "status";

export interface KindredChipProps extends HTMLAttributes<HTMLSpanElement> {
  kind?: ChipKind;
  label: string;
  initial?: string;
  avatar?: "sage" | "accent";
}

export function KindredChip({
  kind = "person",
  label,
  initial,
  avatar = "sage",
  style,
  ...rest
}: KindredChipProps) {
  const pillBase: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    background: "var(--surface-sunken)",
    border: "var(--border-width, 1.5px) solid var(--border)",
    borderRadius: "var(--radius-pill)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-label)",
    fontWeight: 500,
    color: "var(--text-body)",
  };

  if (kind === "person") {
    const avatarBg = avatar === "accent" ? "var(--accent)" : "var(--support)";
    return (
      <span
        style={{
          ...pillBase,
          gap: 9,
          padding: "9px 16px 9px 9px",
          ...style,
        }}
        {...rest}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: avatarBg,
            color: "var(--accent-on)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {(initial ?? label.charAt(0)).toUpperCase()}
        </span>
        {label}
      </span>
    );
  }

  if (kind === "place") {
    return (
      <span
        style={{
          ...pillBase,
          gap: 6,
          padding: "9px 16px",
          color: "var(--text-meta)",
          ...style,
        }}
        {...rest}
      >
        <span aria-hidden="true">📍</span>
        {label}
      </span>
    );
  }

  if (kind === "time") {
    return (
      <span
        style={{
          ...pillBase,
          gap: 8,
          padding: "9px 16px",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-label)",
          letterSpacing: "var(--tracking-mono)",
          fontWeight: 600,
          color: "var(--text-meta)",
          ...style,
        }}
        {...rest}
      >
        {label}
      </span>
    );
  }

  // status
  return (
    <span
      style={{
        ...pillBase,
        gap: 8,
        padding: "6px 14px",
        fontSize: "var(--text-label)",
        fontWeight: 600,
        color: "var(--text-muted)",
        textTransform: "capitalize",
        ...style,
      }}
      {...rest}
    >
      {label}
    </span>
  );
}
