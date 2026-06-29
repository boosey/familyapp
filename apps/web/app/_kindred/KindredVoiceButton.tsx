"use client";
import type { CSSProperties } from "react";
import { Mic, Square } from "lucide-react";
import { common } from "@/app/_copy";

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

  // Mic glyph: lucide microphone, white on accent ground.
  // Stop glyph: lucide filled square for "stop recording".
  const glyphSize = Math.round(size * 0.4); // ~38px at size=96, scales with size

  const captionColor = listening
    ? "var(--accent)"
    : "var(--text-meta)";

  const defaultLabel = saving
    ? common.voiceButton.oneMoment
    : listening
      ? common.voiceButton.listening
      : common.voiceButton.tapToSpeak;

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
        {listening ? (
          <Square
            size={Math.round(size * 0.27)}
            color="var(--accent)"
            fill="var(--accent)"
            strokeWidth={2}
            aria-hidden
          />
        ) : (
          <Mic
            size={glyphSize}
            color="var(--accent-on)"
            strokeWidth={2}
            aria-hidden
            style={{ opacity: saving ? 0.55 : 1, flexShrink: 0 }}
          />
        )}
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
