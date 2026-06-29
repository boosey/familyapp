"use client";

/**
 * Single primary control for the narrator. Idle -> pulsing voice button. Listening -> calm stop with
 * a transcript-style placeholder. Saving/done/softfail mirror the original flow but in Kindred
 * chrome. Long silences NEVER end the session (silence is thinking).
 */
import { useCallback, useRef, useState } from "react";
import { KindredVoiceButton } from "@/app/_kindred";
import { capture, common } from "@/app/_copy";

type Phase = "idle" | "listening" | "saving" | "done" | "softfail";

export function NarratorRecorder({ token, askId = null }: { token: string; askId?: string | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const upload = useCallback(async () => {
    try {
      const type = mediaRecorderRef.current?.mimeType ?? "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      const form = new FormData();
      form.append("token", token);
      form.append("audio", blob, "recording.webm");
      if (askId) form.append("askId", askId);
      const res = await fetch("/api/capture", { method: "POST", body: form });
      setPhase(res.ok ? "done" : "softfail");
    } catch {
      setPhase("softfail");
    }
  }, [token, askId]);

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
      mr.onstop = () => void upload();
      mediaRecorderRef.current = mr;
      mr.start();
      setPhase("listening");
    } catch {
      setPhase("softfail");
    }
  }, [upload]);

  const finish = useCallback(() => {
    setPhase("saving");
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  if (phase === "done") {
    return (
      <p
        aria-live="polite"
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          color: "var(--text-body)",
          margin: 0,
          textAlign: "center",
        }}
      >
        {capture.narrator.thanks}
      </p>
    );
  }

  if (phase === "softfail") {
    return (
      <p
        aria-live="polite"
        className="kin-muted"
        style={{ fontSize: "var(--text-ui-sm)", margin: 0, textAlign: "center", maxWidth: 360 }}
      >
        {capture.narrator.pickUpLater}
      </p>
    );
  }

  const onClick = phase === "listening" ? finish : phase === "idle" ? start : undefined;

  return (
    <KindredVoiceButton
      listening={phase === "listening"}
      saving={phase === "saving"}
      size={220}
      label={phase === "listening" ? common.voiceButton.listening : phase === "saving" ? common.voiceButton.oneMoment : common.voiceButton.tapToSpeak}
      onClick={onClick}
    />
  );
}

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"];
  if (typeof MediaRecorder !== "undefined") {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
  }
  return "audio/webm";
}
