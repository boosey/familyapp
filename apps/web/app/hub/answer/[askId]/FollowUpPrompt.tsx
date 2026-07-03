"use client";

/**
 * Follow-up screen — shown when the interviewer proposes a deepening question mid-thread. Mirrors
 * the record-phase layout (the loud voice button) but with the follow-up prompt as the header and a
 * peer-level "That's all for now" button beside it. Declining is a FIRST-CLASS path, never a dead
 * end: the finish button is a real, full-size ghost button (not a tiny/greyed afterthought).
 *
 * Purely presentational: AnswerFlow owns the recording lifecycle (onVoiceClick) and the finish
 * mutation (onFinish); this component only renders the prompt and wires the two peer controls.
 */
import { KindredVoiceButton, KindredButton } from "@/app/_kindred";
import { hub, common } from "@/app/_copy";

export interface FollowUpPromptProps {
  prompt: string;
  recordPhase: "idle" | "listening" | "saving";
  onVoiceClick: () => void;
  onFinish: () => void;
  finishing: boolean;
  /** A finish-thread failure (or other error) to surface on this screen — declining must never be a
   * silent dead end. When set, it's shown in place of the finish progress line. */
  error?: string;
}

export function FollowUpPrompt({
  prompt,
  recordPhase,
  onVoiceClick,
  onFinish,
  finishing,
  error,
}: FollowUpPromptProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 32,
      }}
    >
      {/* Follow-up header — mirrors the record-phase question header. */}
      <div style={{ textAlign: "center" }}>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            color: "var(--text-meta)",
            letterSpacing: "var(--tracking-mono)",
            margin: "0 0 10px",
          }}
        >
          {hub.answer.followUpIntro}
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
          {prompt}
        </p>
      </div>

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
        onClick={onVoiceClick}
      />

      {/* Declining is a peer-level, first-class path — a full-size ghost button, never a dead end. */}
      <KindredButton
        label={hub.answer.thatsAllForNow}
        variant="ghost"
        size="default"
        disabled={finishing || recordPhase !== "idle"}
        onClick={onFinish}
      />

      {/* Progress while the finish stitch/render runs — the decline tap must visibly register. On a
          failure the error replaces it so the narrator sees "try again" instead of a silent no-op. */}
      {error ? (
        <p
          aria-live="polite"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-danger, #b00)",
            margin: 0,
            textAlign: "center",
          }}
        >
          {error}
        </p>
      ) : finishing ? (
        <p
          role="status"
          aria-live="polite"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            margin: 0,
            textAlign: "center",
          }}
        >
          {hub.answer.finishing}
        </p>
      ) : null}
    </div>
  );
}
