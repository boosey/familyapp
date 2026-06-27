"use client";
import { useState, type ButtonHTMLAttributes, type CSSProperties } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "small" | "default" | "large";

const SIZE_STYLES: Record<Size, CSSProperties> = {
  small:   { minHeight: "44px", fontSize: "1.125rem" },
  default: { minHeight: "64px", fontSize: "1.25rem" },
  large:   { minHeight: "76px", fontSize: "1.5rem" },
};

const VARIANTS: Record<Variant, { base: CSSProperties; hover: CSSProperties }> = {
  primary: {
    base:  { border: "none", background: "var(--accent)", color: "var(--accent-on)" },
    hover: { background: "var(--accent-strong)" },
  },
  secondary: {
    base:  { border: "var(--border-width) solid var(--border-strong)", background: "transparent", color: "var(--text-body)" },
    hover: { background: "var(--accent-soft)" },
  },
  ghost: {
    base:  { border: "none", background: "transparent", color: "var(--accent)" },
    hover: { background: "var(--accent-soft)" },
  },
};

export interface KindredButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  label?: string;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  leadingIcon?: React.ReactNode;
  type?: "button" | "submit" | "reset";
}

export function KindredButton({
  label,
  variant = "primary",
  size = "default",
  fullWidth = false,
  leadingIcon,
  style,
  children,
  type = "button",
  disabled,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: KindredButtonProps) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const v = VARIANTS[variant];

  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    width: fullWidth ? "100%" : undefined,
    padding: "0 24px",
    borderRadius: "var(--radius-pill)",
    fontFamily: "var(--font-ui)",
    fontWeight: 600,
    cursor: "pointer",
    transition: "background .15s, border-color .15s, color .15s",
    ...SIZE_STYLES[size],
  };

  const disabledStyle: CSSProperties = disabled ? { opacity: 0.55, cursor: "not-allowed" } : {};
  const focusStyle: CSSProperties = focused ? { boxShadow: "0 0 0 4px var(--accent-soft)", outline: "none" } : {};

  return (
    <button
      type={type}
      disabled={disabled}
      onMouseEnter={(e) => { setHover(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHover(false); onMouseLeave?.(e); }}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={{ ...base, ...v.base, ...(hover && !disabled ? v.hover : null), ...disabledStyle, ...focusStyle, ...style }}
      {...rest}
    >
      {leadingIcon}
      {children ?? label}
    </button>
  );
}
