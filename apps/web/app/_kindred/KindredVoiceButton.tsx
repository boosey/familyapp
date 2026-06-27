"use client";
import type { CSSProperties } from "react";

export type VoiceButtonState = "idle" | "recording" | "saving";

export interface KindredVoiceButtonProps {
  state?: VoiceButtonState;
  label?: string;
  onClick?: () => void;
  style?: CSSProperties;
  disabled?: boolean;
}

/**
 * The single loud control in Kindred. Idle: pulsing accent disc. Recording: calm stop square
 * inside a tinted ring. Saving: dimmed, no pulse.
 */
export function KindredVoiceButton({
  state = "idle",
  label,
  onClick,
  style,
  disabled,
}: KindredVoiceButtonProps) {
  const recording = state === "recording";
  const saving = state === "saving";

  const ring: CSSProperties = recording
    ? { background: "var(--kin-tint)", border: "2px solid var(--kin-accent)" }
    : saving
      ? { background: "var(--kin-accent-press)", opacity: 0.7 }
      : { background: "var(--kin-accent)", animation: "kin-pulse 2.6s ease-in-out infinite" };

  const glyph: CSSProperties = recording
    ? { width: 26, height: 26, borderRadius: 6, background: "var(--kin-accent)" }
    : { width: 30, height: 46, borderRadius: 16, background: "var(--kin-on-accent)" };

  const text = label ?? (saving ? "One moment…" : recording ? "I'm finished" : "Tap to speak");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        fontFamily: "var(--kin-font-sans)",
        ...style,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || saving}
        aria-label={text}
        style={{
          width: "var(--kin-touch-primary)",
          height: "var(--kin-touch-primary)",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: disabled || saving ? "not-allowed" : "pointer",
          padding: 0,
          ...ring,
        }}
      >
        <span style={glyph} />
      </button>
      <span
        style={{
          fontSize: "var(--kin-text-sm)",
          fontWeight: 700,
          color: recording ? "var(--kin-accent)" : "var(--kin-ink-2)",
        }}
      >
        {text}
      </span>
    </div>
  );
}
