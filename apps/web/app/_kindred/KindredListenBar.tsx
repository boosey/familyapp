"use client";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { common } from "@/app/_copy";

export interface KindredListenBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Audio source URL. When provided, the bar self-manages playback via a real <audio> element. */
  src?: string;
  /** Optional label shown above the scrubber. */
  title?: string;
  /** Pre-formatted duration string, e.g. "3:48". Auto-detected from <audio> metadata when `src` is set. */
  duration?: string;
  /** Controlled mode: current playing state (used when `src` is absent). */
  playing?: boolean;
  /** Controlled mode: called when the user taps play/pause (used when `src` is absent). */
  onToggle?: () => void;
  /** Show the "next story" control. Defaults to `true` when `onNext` is provided. */
  showNext?: boolean;
  /** Called when the user taps "next story". */
  onNext?: () => void;
}

const SKIP_SECONDS = 10;
const KEY_STEP_SECONDS = 5;

/**
 * Warm audio listen bar with a functional scrubber.
 *
 * Two modes:
 * - Audio mode (`src` provided): self-manages playback via a real <audio> element —
 *   seekable track, current time / duration, restart / ±10s / next transport.
 * - Controlled mode (`onToggle`/`playing`, no `src`): play/pause is delegated to the
 *   parent; the seek track and skip controls have no media to act on and are inert.
 *
 * Geometry is explicit px (matching the rest of _kindred); colour/type/motion are tokens.
 */
export function KindredListenBar({
  src,
  title,
  duration,
  playing: playingProp,
  onToggle,
  showNext,
  onNext,
  style,
  ...rest
}: KindredListenBarProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const [audioPlaying, setAudioPlaying] = useState(false);
  const [curSec, setCurSec] = useState(0);
  const [durSec, setDurSec] = useState<number>(() => parseDuration(duration));

  const isAudioMode = Boolean(src);

  // Resolved display state
  const playing = isAudioMode ? audioPlaying : (playingProp ?? false);
  const totalSec = isAudioMode ? durSec : parseDuration(duration);
  const pct = totalSec > 0 ? Math.min(1, Math.max(0, curSec / totalSec)) : 0;
  const curLabel = isAudioMode ? formatDuration(curSec) : "0:00";
  const durLabel = totalSec > 0 ? formatDuration(totalSec) : (duration ?? "—:—");
  const showNextResolved = showNext ?? Boolean(onNext);

  // Wire the real <audio> element in audio mode.
  useEffect(() => {
    if (!isAudioMode) return;
    const a = audioRef.current;
    if (!a) return;

    // Reset the scrubber when the source changes (callers may swap `src` without unmounting).
    setCurSec(0);
    setAudioPlaying(false);
    setDurSec(parseDuration(duration));

    const onTime = () => setCurSec(a.currentTime);
    const onPlay = () => setAudioPlaying(true);
    const onPause = () => setAudioPlaying(false);
    const onEnded = () => setAudioPlaying(false);
    const onMeta = () => {
      if (Number.isFinite(a.duration)) setDurSec(a.duration);
    };

    a.addEventListener("timeupdate", onTime);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
    };
  }, [isAudioMode, src]);

  // Keep the parsed fallback duration in sync if the prop changes (controlled / pre-metadata).
  useEffect(() => {
    if (!isAudioMode) setDurSec(parseDuration(duration));
  }, [duration, isAudioMode]);

  function seekTo(sec: number) {
    const a = audioRef.current;
    if (!a) return;
    const clamped = Math.min(totalSec || a.duration || 0, Math.max(0, sec));
    a.currentTime = clamped;
    setCurSec(clamped);
  }

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

  function seekToClientX(clientX: number) {
    const el = trackRef.current;
    const a = audioRef.current;
    if (!el || !a) return;
    const total = totalSec || a.duration;
    if (!Number.isFinite(total) || total <= 0) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    seekTo(ratio * total);
  }

  function handleTrackPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!isAudioMode) return;
    e.preventDefault();
    seekToClientX(e.clientX);
    const move = (ev: PointerEvent) => seekToClientX(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function handleTrackKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!isAudioMode) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      seekTo(curSec - KEY_STEP_SECONDS);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      seekTo(curSec + KEY_STEP_SECONDS);
    } else if (e.key === "Home") {
      e.preventDefault();
      seekTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      seekTo(totalSec);
    }
  }

  const containerStyle: CSSProperties = {
    background: "var(--surface-card)",
    border: "var(--border-width) solid var(--border)",
    // Canonical bundle uses --radius-card, which is undefined in the token set
    // (tokens/spacing.css only ships sm/md/lg/xl/pill); --radius-lg is the card radius.
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-sm)",
    padding: "var(--space-4) var(--space-5)",
    ...style,
  };

  const timecodeStyle: CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-label)",
    color: "var(--text-meta)",
    letterSpacing: "var(--tracking-mono)",
    flex: "0 0 auto",
    minWidth: 38,
  };

  return (
    <div style={containerStyle} {...rest}>
      {title && (
        <p
          style={{
            margin: "0 0 var(--space-3)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            fontWeight: 500,
            color: "var(--text-body)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </p>
      )}

      {/* Scrubber */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <span style={timecodeStyle}>{curLabel}</span>
        <div
          ref={trackRef}
          onPointerDown={handleTrackPointerDown}
          onKeyDown={handleTrackKeyDown}
          role={isAudioMode ? "slider" : undefined}
          tabIndex={isAudioMode ? 0 : undefined}
          aria-label={isAudioMode ? common.listenBar.seek : undefined}
          aria-valuemin={isAudioMode ? 0 : undefined}
          aria-valuemax={isAudioMode ? Math.round(totalSec) : undefined}
          aria-valuenow={isAudioMode ? Math.round(curSec) : undefined}
          aria-valuetext={isAudioMode ? `${curLabel} of ${durLabel}` : undefined}
          style={{
            position: "relative",
            flex: 1,
            height: 22,
            display: "flex",
            alignItems: "center",
            cursor: isAudioMode ? "pointer" : "default",
            touchAction: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              height: 5,
              borderRadius: "var(--radius-pill)",
              background: "var(--border-strong)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              width: `${pct * 100}%`,
              height: 5,
              borderRadius: "var(--radius-pill)",
              background: "var(--accent)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${pct * 100}%`,
              transform: "translateX(-50%)",
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "var(--accent)",
              boxShadow: "var(--shadow-sm)",
              border: "2px solid var(--surface-card)",
            }}
          />
        </div>
        <span style={{ ...timecodeStyle, textAlign: "right" }}>{durLabel}</span>
      </div>

      {/* Transport */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-4)",
          marginTop: "var(--space-3)",
        }}
      >
        <TransportButton onClick={() => seekTo(0)} title={common.listenBar.startOver} disabled={!isAudioMode}>
          ⏮
        </TransportButton>

        <TransportButton
          onClick={() => seekTo(curSec - SKIP_SECONDS)}
          title={common.listenBar.back10}
          disabled={!isAudioMode}
        >
          <span style={{ fontSize: 30, lineHeight: 1 }}>↺</span>
          <span style={skipLabelStyle}>10</span>
        </TransportButton>

        {/* Play / Pause */}
        <button
          type="button"
          onClick={handleToggle}
          aria-label={playing ? common.listenBar.pause : common.listenBar.play}
          disabled={!isAudioMode && !onToggle}
          style={{
            width: 62,
            height: 62,
            flexShrink: 0,
            borderRadius: "50%",
            background: "var(--accent)",
            border: "none",
            cursor: isAudioMode || onToggle ? "pointer" : "default",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent-on)",
            fontSize: 24,
            opacity: isAudioMode || onToggle ? 1 : 0.6,
            transition: "background var(--dur-fade) var(--ease-quiet)",
          }}
        >
          <span style={{ marginLeft: playing ? 0 : 2 }}>{playing ? "❚❚" : "▶"}</span>
        </button>

        <TransportButton
          onClick={() => seekTo(curSec + SKIP_SECONDS)}
          title={common.listenBar.forward10}
          disabled={!isAudioMode}
        >
          <span style={{ fontSize: 30, lineHeight: 1 }}>↻</span>
          <span style={skipLabelStyle}>10</span>
        </TransportButton>

        {showNextResolved && (
          <TransportButton onClick={() => onNext?.()} title={common.listenBar.nextStory} disabled={!onNext}>
            ⏭
          </TransportButton>
        )}
      </div>

      {isAudioMode && (
        <audio ref={audioRef} src={src} preload="metadata" style={{ display: "none" }} />
      )}
    </div>
  );
}

const skipLabelStyle: CSSProperties = {
  position: "absolute",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 700,
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -40%)",
};

function TransportButton({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      style={{
        position: "relative",
        width: 46,
        height: 46,
        flexShrink: 0,
        borderRadius: "var(--radius-pill)",
        border: "1.5px solid var(--border-strong)",
        background: "var(--surface-card)",
        color: "var(--accent-strong)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontSize: 20,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

function parseDuration(label: string | undefined): number {
  if (!label) return 0;
  const parts = label.split(":").map((n) => parseInt(n, 10) || 0);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  return parts[0] ?? 0;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
