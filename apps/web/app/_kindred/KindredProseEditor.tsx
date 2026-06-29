"use client";
import { useState, type CSSProperties } from "react";

/**
 * Multiline prose editor in Kindred chrome. Prefilled with the AI-polished prose (L2); the narrator
 * edits directly. The parent decides whether the value changed (only then is a correction saved).
 */
export interface KindredProseEditorProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

export function KindredProseEditor({ value, onChange, disabled }: KindredProseEditorProps) {
  const [focused, setFocused] = useState(false);
  const focusStyle: CSSProperties = focused
    ? { boxShadow: "0 0 0 4px var(--accent-soft)", outline: "none" }
    : {};

  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      disabled={disabled}
      rows={12}
      aria-label="Your story, in your words"
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "var(--space-4) var(--space-5)",
        borderRadius: "var(--radius-md)",
        border: "var(--border-width) solid var(--border)",
        background: "var(--surface-card)",
        color: "var(--text-body)",
        fontFamily: "var(--font-story)",
        fontSize: "var(--text-ui)",
        lineHeight: "var(--leading-body)",
        resize: "vertical",
        ...focusStyle,
      }}
    />
  );
}
