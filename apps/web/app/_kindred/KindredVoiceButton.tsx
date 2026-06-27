"use client";
import type { CSSProperties } from "react";

export interface KindredVoiceButtonProps {
  listening?: boolean;
  saving?: boolean;
  disabled?: boolean;
  label?: string;
  size?: number; // px diameter; default 96 (--touch-voice)
  onClick?: () => void;
}

/**
 * The single loud control in Kindred.
 * idle    — accent disc with ambient kindred-listening pulse ring + mic glyph.
 * listening — accent-soft ground + accent border ring + stop square glyph.
 * saving  — dimmed accent-strong disc, not clickable.
 * disabled — not clickable, cursor not-allowed.
 *
 * Uses semantic tokens only; no --kin-* references.
 */
export function KindredVoiceButton({
  listening = false,
  saving = false,
  disabled = false,
  label,
  size = 96,
  onClick,
}: KindredVoiceButtonProps) {
  const isBlocked = disabled || saving;

  const buttonStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: isBlocked ? "not-allowed" : "pointer",
    padding: 0,
    transition: "background var(--dur-settle) var(--ease-quiet), opacity var(--dur-settle) var(--ease-quiet)",
    // State-specific styles
    background: listening
      ? "var(--accent-soft)"
      : saving
        ? "var(--accent-strong)"
        : "var(--accent)",
    border: listening ? "2px solid var(--accent)" : "none",
    boxSizing: "border-box",
    opacity: saving ? 0.7 : 1,
    animation:
      !listening && !saving
        ? "kindred-listening var(--dur-pulse, 2.4s) ease-in-out infinite"
        : "none",
  };

  // Mic glyph: rounded-rect body shape (like a mic capsule), white on accent ground.
  // Stop glyph: 26×26 rounded square for "stop recording".
  const glyphSize = Math.round(size * 0.27); // ~26px at size=96, scales with size
  const glyphStyle: CSSProperties = listening
    ? {
        width: glyphSize,
        height: glyphSize,
        borderRadius: 6,
        background: "var(--accent)",
        flexShrink: 0,
      }
    : {
        // mic body
        width: Math.round(size * 0.3),
        height: Math.round(size * 0.47),
        borderRadius: Math.round(size * 0.16),
        background: "var(--accent-on)",
        flexShrink: 0,
        opacity: saving ? 0.55 : 1,
      };

  const captionColor = listening
    ? "var(--accent)"
    : "var(--text-meta)";

  const defaultLabel = saving
    ? "One moment…"
    : listening
      ? "Listening…"
      : "Tap to speak";

  const caption = label ?? defaultLabel;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        fontFamily: "var(--font-ui)",
      }}
    >
      <button
        type="button"
        onClick={isBlocked ? undefined : onClick}
        disabled={isBlocked}
        aria-label={caption}
        aria-pressed={listening}
        style={buttonStyle}
      >
        <span role="presentation" style={glyphStyle} />
      </button>
      <span
        style={{
          fontSize: "var(--text-label)",
          fontWeight: 700,
          color: captionColor,
          letterSpacing: "0.02em",
          fontFamily: "var(--font-ui)",
        }}
      >
        {caption}
      </span>
    </div>
  );
}
