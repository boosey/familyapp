"use client";

/**
 * Review-pending screen — shown the instant recording stops, while transcribe+render runs in
 * the foreground (awaited by AnswerFlow.uploadRecording). The narrator can replay their take
 * immediately; a spinner + "Polishing your words…" sits over the editor's slot until the prose
 * is ready. When render resolves, AnswerFlow's router.refresh() makes the draft prop arrive and
 * the key remount swaps this screen for the review-ready editor.
 *
 * Purely presentational: AnswerFlow owns the audio object URL, the error, and the retry.
 */
import type { ReactNode } from "react";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";

export interface AnswerReviewPendingProps {
  audioUrl: string;
  error: string | null;
  onRecordAgain: () => void;
  header: ReactNode;
}

export function AnswerReviewPending({
  audioUrl,
  error,
  onRecordAgain,
  header,
}: AnswerReviewPendingProps) {
  return (
    <div>
      {header}

      {/* Relisten the take they just gave (local object URL). A typed telling has no audio, so the
          audio control is omitted (an empty src would trigger a spurious network fetch). */}
      {audioUrl ? (
        /* eslint-disable-next-line jsx-a11y/media-has-caption */
        <audio
          controls
          src={audioUrl}
          style={{
            width: "100%",
            maxWidth: 480,
            display: "block",
            margin: "0 auto 32px",
            borderRadius: "var(--radius-md)",
          }}
        />
      ) : null}

      {error ? (
        <div style={{ textAlign: "center" }}>
          <p
            aria-live="polite"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-danger)",
              margin: "0 0 16px",
            }}
          >
            {error}
          </p>
          <KindredButton
            label={hub.answer.recordAgain}
            variant="secondary"
            size="small"
            onClick={onRecordAgain}
          />
        </div>
      ) : (
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            padding: "32px 0",
            textAlign: "center",
          }}
        >
          <div className="kindred-spinner" aria-hidden="true" />
          <p
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "clamp(1.25rem, 3.5vw, 28px)",
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            {hub.answer.polishing}
          </p>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-meta)",
              margin: 0,
            }}
          >
            {hub.answer.polishingSub}
          </p>
        </div>
      )}
    </div>
  );
}
