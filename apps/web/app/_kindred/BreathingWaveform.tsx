"use client";
import type { CSSProperties } from "react";
import styles from "./BreathingWaveform.module.css";

/**
 * A warm, decorative waveform that breathes with the live mic level while holding-to-record.
 * - Motion allowed: `bars` accent bars scale by the smoothed `level`, each with a per-bar phase
 *   offset so they undulate rather than pulse in lockstep.
 * - Reduced motion (or solemn capture): a single static level bar whose width tracks `level`,
 *   so the narrator still gets feedback without animation.
 *
 * Purely decorative (`aria-hidden`, no text). The `level` prop is supplied by `useAudioLevel`; this
 * component never touches AudioContext itself, so it renders safely in tests and under SSR.
 */
export function BreathingWaveform({
  level,
  reduceMotion,
  bars = 7,
}: {
  level: number;
  reduceMotion: boolean;
  bars?: number;
}) {
  if (reduceMotion) {
    return (
      <div className={styles.staticTrack} aria-hidden>
        <div
          className={styles.staticBar}
          data-static-bar="true"
          style={{ "--lvl": String(level) } as CSSProperties}
        />
      </div>
    );
  }
  return (
    <div className={styles.track} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          data-bar
          className={styles.bar}
          style={{ "--lvl": String(level), "--i": String(i) } as CSSProperties}
        />
      ))}
    </div>
  );
}
