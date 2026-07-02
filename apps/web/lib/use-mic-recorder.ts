"use client";

import { useCallback, useRef, useState } from "react";

export type MicPhase = "idle" | "listening" | "saving";

/**
 * Mic capture, extracted from NarratorRecorder. Owns getUserMedia + MediaRecorder + chunk buffering
 * and hands the finished audio to `onRecorded(blob, mimeType)`. The consumer decides what to do with
 * the blob (POST to /api/capture for stories; a server action for intake). Errors flip to the
 * consumer via onError.
 */
export function useMicRecorder(opts: {
  onRecorded: (blob: Blob, mimeType: string) => void | Promise<void>;
  onError?: () => void;
}) {
  const [phase, setPhase] = useState<MicPhase>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // Keep opts in a ref so start/finish stay stable across renders even when callbacks change.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: pickMimeType() });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const type = mr.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        void optsRef.current.onRecorded(blob, type);
      };
      recorderRef.current = mr;
      mr.start();
      setPhase("listening");
    } catch {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setPhase("idle");
      optsRef.current.onError?.();
    }
  }, []); // stable — reads opts via ref

  const finish = useCallback(() => {
    setPhase("saving");
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return { phase, start, finish };
}

export function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"];
  if (typeof MediaRecorder !== "undefined") {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
  }
  return "audio/webm";
}
