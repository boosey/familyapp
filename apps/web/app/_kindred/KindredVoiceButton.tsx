"use client";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { Mic, Square } from "lucide-react";
import { common } from "@/app/_copy";

export interface KindredVoiceButtonProps {
  listening?: boolean;
  saving?: boolean;
  disabled?: boolean;
  label?: string;
  size?: number; // px diameter; default 96 (--touch-voice)
  onClick?: () => void;
  /**
   * Opt-in press-and-hold ("hold-to-remember") capture. When true the button records while held:
   * pointer-down starts, pointer-up/leave/cancel finishes, and `waveform` replaces the idle pulse
   * while `listening`. When false (the default for every non-capture consumer) the button behaves
   * exactly as before — a tap toggles via `onClick`.
   *
   * Tap-to-toggle remains the motor-accessibility fallback even in hold mode: a tap is a fast
   * pointer-down + pointer-up, which starts then finishes — the same start/finish handlers, so a
   * short tap still captures. `onHoldStart`/`onHoldEnd` should be phase-guarded (start only when
   * idle, finish only when listening) so repeated events don't double-fire.
   */
  holdToRecord?: boolean;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  waveform?: ReactNode;
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
  holdToRecord = false,
  onHoldStart,
  onHoldEnd,
  waveform,
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

  // In hold-to-record mode the caption teaches the gesture (hold → release); otherwise it keeps
  // the tap-to-speak wording. Saving is the same in both modes.
  const defaultLabel = saving
    ? common.voiceButton.oneMoment
    : holdToRecord
      ? listening
        ? common.voiceButton.releaseToFinish
        : common.voiceButton.holdToSpeak
      : listening
        ? common.voiceButton.listening
        : common.voiceButton.tapToSpeak;

  const caption = label ?? defaultLabel;

  // Hold-to-record wiring. Pointer events drive start/finish so a genuine press-and-hold records
  // for exactly as long as it's held; a plain tap (fast down+up) still fires both, preserving the
  // tap-to-toggle fallback. When holdToRecord is off, none of these are attached and the button
  // keeps its original onClick-toggle contract untouched.
  //
  // Keyboard fallback: in hold mode onClick is nulled, so Enter/Space (which a native button turns
  // into a click, NOT pointer events) would do nothing for keyboard-only narrators. A keyboard user
  // can't physically "hold", so Enter/Space is a press-to-start / press-to-stop TOGGLE. `e.repeat`
  // is ignored so a held key doesn't machine-gun start/stop.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!holdToRecord || isBlocked) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.repeat) return;
    e.preventDefault();
    if (listening) onHoldEnd?.();
    else onHoldStart?.();
  };
  const holdHandlers = holdToRecord
    ? {
        onPointerDown: isBlocked ? undefined : onHoldStart,
        onPointerUp: isBlocked ? undefined : onHoldEnd,
        onPointerLeave: isBlocked ? undefined : onHoldEnd,
        onPointerCancel: isBlocked ? undefined : onHoldEnd,
        onKeyDown,
      }
    : {};

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
        // In hold mode the pointer handlers own start/finish; wiring onClick too would double-fire.
        onClick={holdToRecord || isBlocked ? undefined : onClick}
        {...holdHandlers}
        disabled={isBlocked}
        aria-label={caption}
        aria-pressed={listening}
        style={buttonStyle}
      >
        {listening ? (
          waveform ?? (
            <Square
              size={Math.round(size * 0.27)}
              color="var(--accent)"
              fill="var(--accent)"
              strokeWidth={2}
              aria-hidden
            />
          )
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
