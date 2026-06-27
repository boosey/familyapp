"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const DEFAULT_BARS = [6, 12, 20, 28, 18, 10, 24, 32, 22, 14, 8, 18, 26, 16, 10, 20, 30, 14, 22, 12];

export interface KindredListenBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Audio source URL. When provided, the bar self-manages play/pause state via a real <audio> element. */
  src?: string;
  /** Optional label shown above the waveform. */
  title?: string;
  /** Pre-formatted duration string, e.g. "3:48". Auto-detected from <audio> metadata when `src` is set. */
  duration?: string;
  /** Controlled mode: current playing state (used when `src` is absent). */
  playing?: boolean;
  /** Controlled mode: called when the user taps play/pause (used when `src` is absent). */
  onToggle?: () => void;
  /** Waveform bar heights in px. */
  bars?: number[];
}

/**
 * Warm audio listen bar.
 *
 * Two modes:
 * - Audio mode (`src` provided): self-manages play/pause via a real <audio> element;
 *   auto-detects duration from metadata.
 * - Controlled mode (`onToggle`/`playing` provided, no `src`): delegates all state to
 *   the parent; no internal audio.
 *
 * Waveform bars: var(--support) when idle, var(--accent) while playing.
 * Play glyph: ▶ / pause: ⏸ (Unicode glyphs; no icon library required).
 */
export function KindredListenBar({
  src,
  title,
  duration,
  playing: playingProp,
  onToggle,
  bars = DEFAULT_BARS,
  style,
  ...rest
}: KindredListenBarProps) {
  // Audio mode: internal state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [observedDuration, setObservedDuration] = useState<string | undefined>(duration);

  const isAudioMode = Boolean(src);

  // Resolved display values
  const playing = isAudioMode ? audioPlaying : (playingProp ?? false);
  const displayDuration = isAudioMode ? observedDuration : duration;

  useEffect(() => {
    if (!isAudioMode) return;
    const a = audioRef.current;
    if (!a) return;

    const onEnded = () => setAudioPlaying(false);
    const onPlay = () => setAudioPlaying(true);
    const onPause = () => setAudioPlaying(false);
    const onMeta = () => {
      if (!duration && Number.isFinite(a.duration)) {
        setObservedDuration(formatDuration(a.duration));
      }
    };

    a.addEventListener("ended", onEnded);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("loadedmetadata", onMeta);
    return () => {
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("loadedmetadata", onMeta);
    };
  }, [isAudioMode, duration]);

  // Keep observedDuration in sync if duration prop changes externally
  useEffect(() => {
    setObservedDuration(duration);
  }, [duration]);

  function handleToggle() {
    if (isAudioMode) {
      const a = audioRef.current;
      if (!a) return;
      if (a.paused) void a.play();
      else a.pause();
    } else {
      onToggle?.();
    }
  }

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    background: "var(--surface-card)",
    border: "var(--border-width) solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: "16px 20px",
    ...style,
  };

  return (
    <div style={containerStyle} {...rest}>
      {title && (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-label)",
            fontWeight: "var(--weight-medium)" as CSSProperties["fontWeight"],
            color: "var(--text-meta)",
            letterSpacing: "var(--tracking-mono)",
          }}
        >
          {title}
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {/* Play / Pause button */}
        <button
          type="button"
          onClick={handleToggle}
          aria-label={playing ? "Pause" : "Play"}
          disabled={!isAudioMode && !onToggle}
          style={{
            width: 52,
            height: 52,
            flexShrink: 0,
            borderRadius: "50%",
            background: "var(--accent)",
            border: "none",
            cursor: isAudioMode || onToggle ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent-on)",
            fontSize: 22,
            opacity: isAudioMode || onToggle ? 1 : 0.6,
            transition: "background var(--dur-fade) var(--ease-quiet)",
          }}
        >
          {playing ? "⏸" : "▶"}
        </button>

        {/* Waveform */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 3, height: 36 }}>
          {bars.map((h, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                height: h,
                borderRadius: 2,
                background: playing ? "var(--accent)" : "var(--support)",
                transition: `background var(--dur-fade) var(--ease-quiet)`,
              }}
            />
          ))}
        </div>

        {/* Duration */}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            color: "var(--text-meta)",
            letterSpacing: "var(--tracking-mono)",
            flexShrink: 0,
          }}
        >
          {displayDuration ?? "—:—"}
        </span>
      </div>

      {isAudioMode && (
        <audio ref={audioRef} src={src} preload="metadata" style={{ display: "none" }} />
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
