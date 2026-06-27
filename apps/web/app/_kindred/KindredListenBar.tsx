"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const DEFAULT_BARS = [6, 12, 20, 28, 18, 10, 24, 32, 22, 14, 8, 18, 26, 16, 10, 20, 30, 14, 22, 12];

export interface KindredListenBarProps {
  src?: string;
  duration?: string;
  bars?: number[];
  style?: CSSProperties;
}

/**
 * A warm audio player. If `src` is provided, it controls a real <audio> element under the hood.
 * Otherwise it's a static display (kit-style).
 */
export function KindredListenBar({ src, duration, bars = DEFAULT_BARS, style }: KindredListenBarProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [observed, setObserved] = useState<string | undefined>(duration);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onMeta = () => {
      if (!duration && Number.isFinite(a.duration)) {
        setObserved(formatDuration(a.duration));
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
  }, [duration]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        background: "var(--kin-paper)",
        border: "1px solid var(--kin-line)",
        borderRadius: "var(--kin-radius-md)",
        padding: "16px 20px",
        ...style,
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        disabled={!src}
        style={{
          width: 52,
          height: 52,
          flexShrink: 0,
          borderRadius: "50%",
          background: "var(--kin-accent)",
          border: "none",
          cursor: src ? "pointer" : "default",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: src ? 1 : 0.6,
        }}
      >
        {playing ? (
          <span style={{ display: "flex", gap: 4 }}>
            <span style={{ width: 5, height: 18, background: "var(--kin-on-accent)", borderRadius: 1 }} />
            <span style={{ width: 5, height: 18, background: "var(--kin-on-accent)", borderRadius: 1 }} />
          </span>
        ) : (
          <span
            style={{
              width: 0,
              height: 0,
              borderLeft: "16px solid var(--kin-on-accent)",
              borderTop: "11px solid transparent",
              borderBottom: "11px solid transparent",
              marginLeft: 4,
            }}
          />
        )}
      </button>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 3, height: 36 }}>
        {bars.map((h, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: h,
              borderRadius: 2,
              background: playing ? "var(--kin-accent)" : "var(--kin-gold)",
              transition: "background .15s",
            }}
          />
        ))}
      </div>
      <span style={{ fontFamily: "var(--kin-font-mono)", fontSize: 14, color: "var(--kin-ink-2)", flexShrink: 0 }}>
        {observed ?? "—:—"}
      </span>
      {src ? <audio ref={audioRef} src={src} preload="metadata" style={{ display: "none" }} /> : null}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
