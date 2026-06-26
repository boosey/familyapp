"use client";

/**
 * The single primary control. Idle -> one big "Start talking" button. While listening -> a clear
 * "it is listening" indicator and one unmistakable "I'm finished" button. Long silences NEVER end
 * the session (silence is thinking). When finished, the wideband audio is uploaded; the elder
 * sees only warm copy — any failure stays silent toward them and is surfaced to the family
 * elsewhere.
 */
import { useCallback, useRef, useState } from "react";

type Phase = "idle" | "listening" | "saving" | "done" | "softfail";

export function ElderRecorder({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Wideband, clean capture — the web-link quality advantage over a phone call.
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
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
      // Mic permission denied or unavailable — warm dead-end, nothing to fix on screen.
      setPhase("softfail");
    }
  }, []);

  const finish = useCallback(() => {
    setPhase("saving");
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

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

  if (phase === "done") {
    return (
      <p className="greeting" aria-live="polite">
        Thank you. Your family will love hearing this.
      </p>
    );
  }

  if (phase === "softfail") {
    return (
      <p className="subtle" aria-live="polite">
        Let’s pick this up another time. The person who invited you will check
        in soon.
      </p>
    );
  }

  if (phase === "listening") {
    return (
      <>
        <div className="listening-dot" aria-hidden="true" />
        <p className="subtle" aria-live="polite">
          I’m listening…
        </p>
        <button className="big-button listening" onClick={finish}>
          I’m finished
        </button>
      </>
    );
  }

  return (
    <button
      className="big-button"
      onClick={start}
      disabled={phase === "saving"}
    >
      {phase === "saving" ? "One moment…" : "Start talking"}
    </button>
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
