"use client";

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
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      rows={12}
      aria-label="Your story, in your words"
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "18px 20px",
        borderRadius: "var(--radius-md)",
        border: "1.5px solid var(--border)",
        background: "var(--surface-card)",
        color: "var(--text-body)",
        fontFamily: "var(--font-story)",
        fontSize: "var(--text-ui)",
        lineHeight: "var(--leading-body)",
        resize: "vertical",
      }}
    />
  );
}
