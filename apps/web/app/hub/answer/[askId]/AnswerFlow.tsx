"use client";

/**
 * Two-phase answer flow — record then review (relisten + tier-pick + share/re-record/discard).
 *
 * Phase is server-driven: if `draft` is null, the narrator hasn't recorded yet (record phase);
 * if `draft` is non-null, they have a saved take ready to review (review phase). The server
 * component re-renders after each action via router.refresh(), updating the props.
 *
 * Mirrors NarratorRecorder (record UX) and ApprovalRecorder (tier-picker pattern) in Kindred
 * chrome. All server mutations go through the three server actions in actions.ts — personId is
 * never sent by the client.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KindredVoiceButton, KindredButton, KindredProseEditor } from "@/app/_kindred";
import { hub, common } from "@/app/_copy";
import { relativeShortDate } from "@/lib/relative-time";
import { recordAnswerAction, shareAnswerAction, discardAnswerAction } from "./actions";

type RecordPhase = "idle" | "listening" | "saving" | "softfail";
type Tier = "family" | "branch" | "public";
type Op = "share" | "rerecord" | "discard" | null;

const TIER_ORDER: Tier[] = ["family", "branch", "public"];

export interface DraftInfo {
  storyId: string;
  recordedAt: string; // ISO string (serialized from Date by the server component)
  mediaUrl: string;
  prose: string;
}

interface AnswerFlowProps {
  askId: string;
  questionText: string;
  askerName: string;
  draft: DraftInfo | null;
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

export function AnswerFlow({ askId, questionText, askerName, draft }: AnswerFlowProps) {
  const router = useRouter();

  // ── Record phase state ──────────────────────────────────────────────────────
  const [recordPhase, setRecordPhase] = useState<RecordPhase>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Review phase state ──────────────────────────────────────────────────────
  const [tier, setTier] = useState<Tier>("family");
  const [op, setOp] = useState<Op>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [proseDraft, setProseDraft] = useState(draft?.prose ?? "");

  // ── Record phase handlers ───────────────────────────────────────────────────
  const uploadRecording = useCallback(async () => {
    try {
      const type = mediaRecorderRef.current?.mimeType ?? "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      form.append("askId", askId);
      const result = await recordAnswerAction(form);
      if (result?.error) {
        setRecordPhase("softfail");
      } else {
        // Refresh the server component to pick up the new draft (transitions to review phase).
        router.refresh();
      }
    } catch {
      setRecordPhase("softfail");
    }
  }, [askId, router]);

  const startRecording = useCallback(async () => {
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
      mr.onstop = () => void uploadRecording();
      mediaRecorderRef.current = mr;
      mr.start();
      setRecordPhase("listening");
    } catch {
      setRecordPhase("softfail");
    }
  }, [uploadRecording]);

  const stopRecording = useCallback(() => {
    setRecordPhase("saving");
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // ── Review phase handlers ───────────────────────────────────────────────────
  const handleShare = async () => {
    setActionError(null);
    setOp("share");
    try {
      const form = new FormData();
      form.append("storyId", draft!.storyId);
      form.append("audienceTier", tier);
      if (proseDraft !== draft!.prose) {
        form.append("correctedProse", proseDraft);
      }
      const result = await shareAnswerAction(form);
      if (result?.error) {
        setActionError(result.error);
        setOp(null);
      }
      // On success the server action calls redirect("/hub") — navigation happens automatically.
    } catch {
      setActionError(hub.answer.genericError);
      setOp(null);
    }
  };

  const handleReRecord = async () => {
    setActionError(null);
    setOp("rerecord");
    try {
      const form = new FormData();
      form.append("storyId", draft!.storyId);
      const result = await discardAnswerAction(form);
      if (result?.error) {
        // The draft was NOT removed — stay put. Switching to the record phase here would tell
        // the narrator their take is gone while it silently survives as an orphan.
        setActionError(result.error);
        setOp(null);
        return;
      }
      router.refresh(); // discard succeeded → server re-renders with draft=null → record phase
    } catch {
      setActionError(hub.actions.removeFailed);
      setOp(null);
    }
  };

  const handleDiscard = async () => {
    setActionError(null);
    setOp("discard");
    try {
      const form = new FormData();
      form.append("storyId", draft!.storyId);
      const result = await discardAnswerAction(form);
      if (result?.error) {
        // The draft was NOT removed — do not navigate away as if it had been (would leave a
        // permanent orphan the narrator believes is discarded).
        setActionError(result.error);
        setOp(null);
        return;
      }
      router.push("/hub?tab=questions");
    } catch {
      setActionError(hub.actions.removeFailed);
      setOp(null);
    }
  };

  // ── Shared question header ──────────────────────────────────────────────────
  const questionHeader = (
    <div style={{ marginBottom: 32, textAlign: "center" }}>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-label)",
          color: "var(--text-meta)",
          letterSpacing: "var(--tracking-mono)",
          margin: "0 0 10px",
        }}
      >
        {hub.answer.askedBy(askerName)}
      </p>
      <p
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "clamp(1.35rem, 3.5vw, var(--text-story-lg))",
          lineHeight: "var(--leading-snug)",
          color: "var(--text-body)",
          margin: 0,
          maxWidth: "28ch",
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {questionText}
      </p>
    </div>
  );

  // ── REVIEW PHASE ────────────────────────────────────────────────────────────
  if (draft) {
    // Sharing: show a warm interstitial while the pipeline runs
    if (op === "share") {
      return (
        <div
          aria-live="polite"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
            textAlign: "center",
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
            {hub.answer.assembling}
          </p>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-meta)",
              margin: 0,
            }}
          >
            {hub.answer.assemblingSub}
          </p>
        </div>
      );
    }

    const isRemoving = op === "rerecord" || op === "discard";

    return (
      <div>
        {questionHeader}

        {/* Recorded timestamp */}
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            color: "var(--text-meta)",
            letterSpacing: "var(--tracking-mono)",
            textAlign: "center",
            margin: "0 0 20px",
          }}
        >
          {hub.answer.recordedAt(relativeShortDate(draft.recordedAt))}
        </p>

        {/* Relisten */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          controls
          src={draft.mediaUrl}
          style={{
            width: "100%",
            maxWidth: 480,
            display: "block",
            margin: "0 auto 32px",
            borderRadius: "var(--radius-md)",
          }}
        />

        {/* Read + edit the polished prose before sharing */}
        <div style={{ marginBottom: 32 }}>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--support)",
              margin: "0 0 14px",
            }}
          >
            {hub.answer.reviewYourWords}
          </p>
          <KindredProseEditor
            value={proseDraft}
            onChange={setProseDraft}
            disabled={isRemoving}
          />
        </div>

        {/* Tier picker (mirrors ApprovalRecorder) */}
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 32px" }}>
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
            {hub.answer.whoShouldHear}
          </legend>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {TIER_ORDER.map((value) => {
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
                    padding: "16px 20px",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    transition: "background var(--dur-fade)",
                    background: checked ? "var(--accent-soft)" : "var(--surface-card)",
                    border: `1.5px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                    boxSizing: "border-box",
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

        {/* Error */}
        {actionError && (
          <p
            aria-live="polite"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-danger, #b00)",
              margin: "0 0 16px",
              textAlign: "center",
            }}
          >
            {actionError}
          </p>
        )}

        {/* Share */}
        <div style={{ marginBottom: 14 }}>
          <KindredButton
            label={hub.answer.shareWithFamily}
            variant="primary"
            size="large"
            fullWidth
            disabled={isRemoving}
            onClick={handleShare}
          />
        </div>

        {/* Re-record / Discard row */}
        <div style={{ display: "flex", gap: 12 }}>
          <KindredButton
            label={hub.answer.reRecord}
            variant="secondary"
            size="small"
            fullWidth
            disabled={isRemoving}
            onClick={handleReRecord}
          />
          <KindredButton
            label={hub.answer.discard}
            variant="ghost"
            size="small"
            fullWidth
            disabled={isRemoving}
            onClick={handleDiscard}
          />
        </div>
      </div>
    );
  }

  // ── RECORD PHASE ────────────────────────────────────────────────────────────
  if (recordPhase === "softfail") {
    return (
      <div style={{ textAlign: "center" }}>
        {questionHeader}
        <p
          aria-live="polite"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            margin: "0 auto",
            maxWidth: 360,
          }}
        >
          {hub.answer.micError}
        </p>
      </div>
    );
  }

  const voiceClick =
    recordPhase === "listening"
      ? stopRecording
      : recordPhase === "idle"
        ? startRecording
        : undefined;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 32,
      }}
    >
      {questionHeader}
      <KindredVoiceButton
        listening={recordPhase === "listening"}
        saving={recordPhase === "saving"}
        size={220}
        label={
          recordPhase === "listening"
            ? hub.answer.listeningTapStop
            : recordPhase === "saving"
              ? common.voiceButton.oneMoment
              : common.voiceButton.tapToSpeak
        }
        onClick={voiceClick}
      />
      {recordPhase === "idle" && (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            margin: 0,
            textAlign: "center",
            maxWidth: 300,
          }}
        >
          {hub.answer.takeYourTime}
        </p>
      )}
    </div>
  );
}
