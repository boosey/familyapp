"use client";
import { useState, type ButtonHTMLAttributes, type CSSProperties } from "react";

type Variant = "primary" | "secondary" | "ghost";

const BASE: CSSProperties = {
  width: "100%",
  minHeight: "var(--kin-touch-default)",
  padding: "0 24px",
  borderRadius: "var(--kin-radius-sm)",
  fontFamily: "var(--kin-font-sans)",
  fontSize: "var(--kin-text-body)",
  fontWeight: 600,
  cursor: "pointer",
  transition: "background .15s, border-color .15s, color .15s",
};

const VARIANTS: Record<Variant, { base: CSSProperties; hover: CSSProperties }> = {
  primary: {
    base: { border: "none", background: "var(--kin-accent)", color: "var(--kin-on-accent)" },
    hover: { background: "var(--kin-accent-press)" },
  },
  secondary: {
    base: { border: "1.5px solid var(--kin-field)", background: "transparent", color: "var(--kin-body)" },
    hover: { background: "var(--kin-tint)", borderColor: "var(--kin-accent)" },
  },
  ghost: {
    base: { border: "none", background: "transparent", color: "var(--kin-accent)" },
    hover: { background: "var(--kin-tint)" },
  },
};

export interface KindredButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  label?: string;
  variant?: Variant;
  type?: "button" | "submit" | "reset";
}

export function KindredButton({
  label,
  variant = "primary",
  style,
  children,
  type = "button",
  disabled,
  ...rest
}: KindredButtonProps) {
  const [hover, setHover] = useState(false);
  const v = VARIANTS[variant];
  const disabledStyle: CSSProperties = disabled ? { opacity: 0.55, cursor: "not-allowed" } : {};
  return (
    <button
      type={type}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...BASE, ...v.base, ...(hover && !disabled ? v.hover : null), ...disabledStyle, ...style }}
      {...rest}
    >
      {label ?? children}
    </button>
  );
}
