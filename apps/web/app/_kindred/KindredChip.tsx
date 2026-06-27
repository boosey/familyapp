import type { CSSProperties } from "react";

export type ChipKind = "person" | "place" | "time" | "status";

export interface KindredChipProps {
  kind?: ChipKind;
  label: string;
  initial?: string;
  avatar?: "sage" | "accent";
  style?: CSSProperties;
}

export function KindredChip({ kind = "person", label, initial, avatar = "sage", style }: KindredChipProps) {
  if (kind === "person") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 9,
          background: "var(--kin-chip-bg)",
          border: "1px solid var(--kin-chip-border)",
          borderRadius: "var(--kin-radius-pill)",
          padding: "9px 16px 9px 9px",
          fontFamily: "var(--kin-font-sans)",
          fontSize: "var(--kin-text-sm)",
          fontWeight: 500,
          color: "var(--kin-ink)",
          ...style,
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: avatar === "accent" ? "var(--kin-accent)" : "var(--kin-sage)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {(initial ?? label.charAt(0)).toUpperCase()}
        </span>
        {label}
      </span>
    );
  }

  const isTime = kind === "time";
  const isStatus = kind === "status";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: isStatus ? "var(--kin-chip-bg)" : "transparent",
        border: isStatus ? "1px solid var(--kin-chip-border)" : "1.5px solid var(--kin-field)",
        borderRadius: "var(--kin-radius-pill)",
        padding: "9px 16px",
        fontSize: "var(--kin-text-sm)",
        fontWeight: isTime ? 600 : 500,
        color: "var(--kin-ink-2)",
        fontFamily: isTime ? "var(--kin-font-mono)" : "var(--kin-font-sans)",
        ...style,
      }}
    >
      {isTime || isStatus ? label : `📍 ${label}`}
    </span>
  );
}
