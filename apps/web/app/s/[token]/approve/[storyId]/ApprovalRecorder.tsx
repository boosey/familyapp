"use client";

/**
 * Approval recorder, in Kindred chrome. Vertical radio-row tier picker (default: family) so the
 * elder's spoken approval applies to the audience they actually want — then the single loud voice
 * button. Preserves the approval POST to `/api/capture/approve` with audienceTier.
 */
import { useCallback, useRef, useState } from "react";
import { KindredVoiceButton, KindredButton } from "@/app/_kindred";

type Phase = "idle" | "listening" | "saving" | "done" | "softfail";
type Tier = "family" | "branch" | "public";

const TIERS: { value: Tier; label: string; desc: string }[] = [
  { value: "family", label: "My whole family",   desc: "Everyone in the family" },
  { value: "branch", label: "Just one branch",   desc: "A chosen part of the family" },
  { value: "public", label: "Anyone",             desc: "Shared openly" },
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

  // ── done ───────────────────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <div
        aria-live="polite"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 30,
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-story)",
            fontWeight: 400,
            fontSize: "clamp(1.75rem, 5vw, 40px)",
            lineHeight: 1.25,
            color: "var(--text-body)",
            maxWidth: "18ch",
            margin: 0,
          }}
        >
          Thank you. Your family will hear it now.
        </p>
      </div>
    );
  }

  // ── softfail ───────────────────────────────────────────────────────────────
  if (phase === "softfail") {
    return (
      <p
        aria-live="polite"
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-muted)",
          margin: 0,
          textAlign: "center",
        }}
      >
        Let&apos;s pick this up another time. The person who invited you will check in soon.
      </p>
    );
  }

  // ── saving ─────────────────────────────────────────────────────────────────
  if (phase === "saving") {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "clamp(1.5rem, 4vw, 32px)",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          One moment…
        </p>
      </div>
    );
  }

  // ── listening ──────────────────────────────────────────────────────────────
  if (phase === "listening") {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "clamp(1.25rem, 3.5vw, 28px)",
            lineHeight: 1.3,
            color: "var(--text-muted)",
            textAlign: "center",
            maxWidth: "22ch",
            margin: 0,
          }}
        >
          Say it in your own words — &quot;Yes, my family can hear this.&quot;
        </p>
        <KindredVoiceButton
          listening={true}
          size={150}
          label="Listening…"
          onClick={finish}
        />
        <div style={{ width: "100%", maxWidth: 440 }}>
          <KindredButton variant="primary" size="large" fullWidth onClick={finish}>
            I&apos;m finished
          </KindredButton>
        </div>
      </div>
    );
  }

  // ── idle ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {/* Tier picker */}
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--support)",
            marginBottom: 14,
            display: "block",
            width: "100%",
          }}
        >
          Who should hear this?
        </legend>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {TIERS.map((opt) => {
            const checked = tier === opt.value;
            return (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  width: "100%",
                  textAlign: "left",
                  padding: "16px 20px",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  transition: "background var(--dur-fade)",
                  background: checked ? "var(--accent-soft)" : "var(--surface-card)",
                  border: `1.5px solid ${checked ? "var(--accent)" : "var(--border)"}`,
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
                {/* Radio dot */}
                <span
                  style={{
                    flex: "0 0 auto",
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `2px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
                    background: checked ? "var(--accent)" : "transparent",
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "var(--accent-on)",
                      opacity: checked ? 1 : 0,
                      transition: "opacity var(--dur-fade)",
                    }}
                  />
                </span>
                {/* Label + description */}
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--text-ui)",
                      fontWeight: 600,
                      color: "var(--text-body)",
                    }}
                  >
                    {opt.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--text-label)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {opt.desc}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Spacer + voice button */}
      <div style={{ flex: 1 }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          paddingTop: 32,
          paddingBottom: 8,
        }}
      >
        <KindredVoiceButton
          listening={false}
          size={150}
          label="Approve aloud"
          onClick={start}
        />
      </div>
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
