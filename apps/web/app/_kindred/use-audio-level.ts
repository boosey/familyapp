"use client";
import { useEffect, useRef, useState } from "react";

/** Smoothed RMS level (0–1) of a live mic stream. Returns a frozen 0 when disabled
 *  (no stream, or reduced motion) so the waveform can render a static bar instead. */
export function useAudioLevel(stream: MediaStream | null, enabled: boolean): number {
  const [level, setLevel] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!stream || !enabled) {
      setLevel(0);
      return;
    }
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const c = (v - 128) / 128;
        sum += c * c;
      }
      const rms = Math.sqrt(sum / buf.length);
      setLevel((prev) => prev * 0.7 + Math.min(1, rms * 2.2) * 0.3); // smoothing
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      src.disconnect();
      void ctx.close();
    };
  }, [stream, enabled]);
  return level;
}
