"use client";

/**
 * Approval recorder, in Kindred chrome. Audience picker as pill radios (default: family) so the
 * elder's spoken approval applies to the audience they actually want — then the single loud voice
 * button.
 */
import { useCallback, useRef, useState } from "react";
import { KindredVoiceButton } from "@/app/_kindred";

type Phase = "idle" | "listening" | "saving" | "done" | "softfail";
type Tier = "family" | "branch" | "public";

const TIERS: { value: Tier; label: string }[] = [
  { value: "family", label: "My whole family" },
  { value: "branch", label: "A branch of the family" },
  { value: "public", label: "Anyone" },
];

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

  const upload = useCallback(async () => {
    try {
      const type = mediaRecorderRef.current?.mimeType ?? "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      const form = new FormData();
      form.append("token", token);
      form.append("storyId", storyId);
      form.append("audienceTier", tier);
      form.append("audio", blob, "approval.webm");
      const res = await fetch("/api/capture/approve", { method: "POST", body: form });
      setPhase(res.ok ? "done" : "softfail");
    } catch {
      setPhase("softfail");
    }
  }, [token, storyId, tier]);

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
        Thank you. Your family will hear it now.
      </p>
    );
  }
  if (phase === "softfail") {
    return (
      <p
        aria-live="polite"
        className="kin-muted"
        style={{ fontSize: "var(--kin-text-body)", margin: 0, textAlign: "center" }}
      >
        Let's pick this up another time. The person who invited you will check in soon.
      </p>
    );
  }

  const recording = phase === "listening";
  const saving = phase === "saving";
  const state = recording ? "recording" : saving ? "saving" : "idle";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, alignItems: "center" }}>
      {!recording && !saving ? (
        <fieldset
          style={{
            border: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <legend className="kin-label" style={{ width: "100%", textAlign: "center", marginBottom: 12 }}>
            Share with
          </legend>
          {TIERS.map((opt) => {
            const checked = tier === opt.value;
            return (
              <label
                key={opt.value}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 20px",
                  minHeight: "var(--kin-touch-default)",
                  borderRadius: "var(--kin-radius-pill)",
                  border: checked ? "2px solid var(--kin-accent)" : "1.5px solid var(--kin-field)",
                  background: checked ? "var(--kin-tint)" : "transparent",
                  color: checked ? "var(--kin-accent)" : "var(--kin-ink-2)",
                  fontSize: "var(--kin-text-body)",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background .15s, border-color .15s",
                }}
              >
                <input
                  type="radio"
                  name="audienceTier"
                  value={opt.value}
                  checked={checked}
                  onChange={() => setTier(opt.value)}
                  style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                />
                {opt.label}
              </label>
            );
          })}
        </fieldset>
      ) : null}

      <KindredVoiceButton
        state={state}
        label={
          recording ? "I'm finished" : saving ? "One moment…" : "Approve aloud"
        }
        onClick={recording ? finish : !saving ? start : undefined}
      />
    </div>
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
