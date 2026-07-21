"use client";

/**
 * Approval recorder, in Kindred chrome. Vertical radio-row tier picker (default: family) so the
 * narrator's spoken approval applies to the audience they actually want — then the single loud voice
 * button. Preserves the approval POST to `/api/capture/approve` with audience tiers.
 *
 * Recording gesture follows the same device-local phone/desktop preference as hub compose,
 * onboarding, and link-session narrator capture (#263/#264). Idle + listening share one
 * KindredVoiceButton so hold-to-record can start on press and finish on release across the phase
 * change (separate early-return trees would remount the button and drop the release).
 */
import { useCallback, useRef, useState } from "react";
import { KindredVoiceButton, KindredButton, KindredProseEditor } from "@/app/_kindred";
import { useRecordingGesture } from "@/app/_kindred/useRecordingGesture";
import { capture, common } from "@/app/_copy";

type Phase = "idle" | "listening" | "saving" | "done" | "softfail";
type Tier = "family" | "branch" | "public";

export function ApprovalRecorder({
  token,
  storyId,
  prose,
}: {
  token: string;
  storyId: string;
  prose: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [tier, setTier] = useState<Tier>("family");
  const [proseDraft, setProseDraft] = useState(prose);
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
      if (proseDraft !== prose) {
        form.append("correctedProse", proseDraft);
      }
      const res = await fetch("/api/capture/approve", { method: "POST", body: form });
      setPhase(res.ok ? "done" : "softfail");
    } catch {
      setPhase("softfail");
    }
  }, [token, storyId, tier, prose, proseDraft]);

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
    // KindredVoiceButton fires onHoldEnd on both pointerup and pointerleave for one release —
    // finish must be idempotent (same contract as useMicRecorder.finish / ComposingEditor).
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") return;
    setPhase("saving");
    mr.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // Gesture prefs + hold race fix MUST sit above phase early-returns (rules of hooks).
  const { holdToRecord } = useRecordingGesture();
  const heldRef = useRef(false);
  const onHoldStart = useCallback(async () => {
    if (phase !== "idle") return;
    heldRef.current = true;
    await start();
    // Released before the mic was ready → stop immediately. finish() is safe even when start
    // failed (no recorder) — MediaRecorder stop on null is guarded; phase may still be idle.
    if (!heldRef.current && mediaRecorderRef.current) finish();
  }, [phase, start, finish]);
  const onHoldEnd = useCallback(() => {
    heldRef.current = false;
    if (phase === "listening") finish();
  }, [phase, finish]);
  const onTapToggle = useCallback(() => {
    if (phase === "listening") finish();
    else if (phase === "idle") void start();
  }, [phase, start, finish]);

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
          {capture.approve.confirmedThanks}
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
        {capture.approve.pickUpLater}
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
          {capture.approve.oneMoment}
        </p>
      </div>
    );
  }

  // ── idle + listening (shared mic so hold gesture survives the phase change) ─
  const voiceLabel = holdToRecord
    ? phase === "listening"
      ? common.voiceButton.releaseToFinish
      : common.voiceButton.holdToSpeak
    : phase === "listening"
      ? capture.approve.listening
      : capture.approve.approveAloud;

  // Mic footer is pinned below a flex:1 content region so idle→listening content swap does not
  // move the button on screen (a jump would fire pointerleave and end a hold mid-press).
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {phase === "idle" ? (
          <>
            {/* Read + edit the polished prose before approving */}
            <div style={{ marginBottom: 28 }}>
              <KindredProseEditor
                value={proseDraft}
                onChange={setProseDraft}
                historyKey={storyId}
                labels={common.proseEditor}
                onPolish={async (text) => {
                  const form = new FormData();
                  form.append("token", token);
                  form.append("storyId", storyId);
                  form.append("prose", text);
                  const res = await fetch("/api/capture/polish", { method: "POST", body: form });
                  if (!res.ok) throw new Error("polish failed");
                  const data = (await res.json()) as { prose?: string };
                  return typeof data.prose === "string" ? data.prose : text;
                }}
              />
            </div>

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
                {capture.approve.whoShouldHear}
              </legend>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {(["family", "branch", "public"] as Tier[]).map((value) => {
                  const opt = common.audienceTiers[value];
                  const checked = tier === value;
                  return (
                    <label
                      key={value}
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
                        value={value}
                        checked={checked}
                        onChange={() => setTier(value)}
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
          </>
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "24px 0",
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
              {capture.approve.sayInOwnWords}
            </p>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          paddingTop: 32,
          paddingBottom: 8,
          flexShrink: 0,
        }}
      >
        {/* Above the mic so appearing mid-hold grows the footer upward — mic stays at the bottom edge. */}
        {phase === "listening" ? (
          <div style={{ width: "100%", maxWidth: 440 }}>
            <KindredButton variant="primary" size="large" fullWidth onClick={finish}>
              {capture.approve.imFinished}
            </KindredButton>
          </div>
        ) : null}
        <KindredVoiceButton
          listening={phase === "listening"}
          size={150}
          label={voiceLabel}
          holdToRecord={holdToRecord}
          onHoldStart={holdToRecord ? onHoldStart : undefined}
          onHoldEnd={holdToRecord ? onHoldEnd : undefined}
          onClick={holdToRecord ? undefined : onTapToggle}
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
