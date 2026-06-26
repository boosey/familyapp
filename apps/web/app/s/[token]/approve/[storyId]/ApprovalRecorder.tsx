"use client";

/**
 * The approval recorder. Tier picker first (default: family) so the elder's spoken approval
 * applies to the audience they actually want — then one big "Approve aloud" record control. Phase
 * shape mirrors `ElderRecorder` (idle/listening/saving/done/softfail) so the elder sees a familiar
 * interaction; the only added input is the tier.
 */
import { useCallback, useRef, useState } from "react";

type Phase = "idle" | "listening" | "saving" | "done" | "softfail";
type Tier = "family" | "branch" | "public";

export function ApprovalRecorder({
  token,
  storyId,
}: {
  token: string;
  storyId: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [tier, setTier] = useState<Tier>("family");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
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
      form.append("storyId", storyId);
      form.append("audienceTier", tier);
      form.append("audio", blob, "approval.webm");
      const res = await fetch("/api/capture/approve", {
        method: "POST",
        body: form,
      });
      setPhase(res.ok ? "done" : "softfail");
    } catch {
      setPhase("softfail");
    }
  }, [token, storyId, tier]);

  if (phase === "done") {
    return (
      <p className="greeting" aria-live="polite">
        Thank you. Your family will hear it now.
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
    <>
      <fieldset
        style={{
          border: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          alignItems: "center",
        }}
      >
        <legend className="subtle" style={{ marginBottom: "0.5rem" }}>
          Share with
        </legend>
        {(["family", "branch", "public"] as const).map((opt) => (
          <label key={opt} style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <input
              type="radio"
              name="audienceTier"
              value={opt}
              checked={tier === opt}
              onChange={() => setTier(opt)}
              style={{ width: "1.5rem", height: "1.5rem" }}
            />
            {labelFor(opt)}
          </label>
        ))}
      </fieldset>
      <button
        className="big-button"
        onClick={start}
        disabled={phase === "saving"}
      >
        {phase === "saving" ? "One moment…" : "Approve aloud"}
      </button>
    </>
  );
}

function labelFor(t: Tier): string {
  switch (t) {
    case "family":
      return "My whole family";
    case "branch":
      return "A branch of the family";
    case "public":
      return "Anyone";
  }
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
