"use client";

/**
 * Single primary control for the elder. Idle -> pulsing voice button. Listening -> calm stop with
 * a transcript-style placeholder. Saving/done/softfail mirror the original flow but in Kindred
 * chrome. Long silences NEVER end the session (silence is thinking).
 */
import { useCallback, useRef, useState } from "react";
import { KindredVoiceButton } from "@/app/_kindred";

type Phase = "idle" | "listening" | "saving" | "done" | "softfail";

export function ElderRecorder({ token }: { token: string }) {
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
      const res = await fetch("/api/capture", { method: "POST", body: form });
      setPhase(res.ok ? "done" : "softfail");
    } catch {
      setPhase("softfail");
    }
  }, [token]);

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
          fontFamily: "var(--kin-font-serif)",
          fontSize: "var(--kin-text-headline)",
          color: "var(--kin-ink)",
          margin: 0,
          textAlign: "center",
        }}
      >
        Thank you. Your family will love hearing this.
      </p>
    );
  }

  if (phase === "softfail") {
    return (
      <p
        aria-live="polite"
        className="kin-muted"
        style={{ fontSize: "var(--kin-text-body)", margin: 0, textAlign: "center", maxWidth: 360 }}
      >
        Let's pick this up another time. The person who invited you will check in soon.
      </p>
    );
  }

  const state = phase === "listening" ? "recording" : phase === "saving" ? "saving" : "idle";
  const onClick = phase === "listening" ? finish : phase === "idle" ? start : undefined;

  return <KindredVoiceButton state={state} onClick={onClick} />;
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
