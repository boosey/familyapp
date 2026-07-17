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
  // The live capture stream, surfaced as state so consumers (e.g. a mic-level waveform) can react
  // to it. It mirrors streamRef, which stays the imperative handle used to stop the tracks.
  const [stream, setStream] = useState<MediaStream | null>(null);
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
      setStream(stream);
      chunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: pickMimeType() });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const type = mr.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        void optsRef.current.onRecorded(blob, type);
        // Reset so the button is re-usable for the next question (AboutYouFlow recycles the
        // same hook across questions). NarratorRecorder is unaffected — it renders a done
        // screen off its own component state, not micPhase.
        setPhase("idle");
      };
      recorderRef.current = mr;
      mr.start();
      setPhase("listening");
    } catch {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
      setPhase("idle");
      optsRef.current.onError?.();
    }
  }, []); // stable — reads opts via ref

  const finish = useCallback(() => {
    setPhase("saving");
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  return { phase, start, finish, stream };
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
