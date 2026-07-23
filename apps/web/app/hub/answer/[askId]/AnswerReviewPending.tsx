"use client";

/**
 * Review-pending screen — shown the instant recording stops, while transcribe+cleanup runs in
 * the foreground (awaited by ComposingEditor.uploadRecording). Spinner + "Polishing your words…"
 * until the draft surface remounts. No audio playback here (capture keeps mic/edit only).
 *
 * Purely presentational: the parent owns the error and the retry.
 */
import type { ReactNode } from "react";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { hub } from "@/app/_copy";

export interface AnswerReviewPendingProps {
  error: string | null;
  onRecordAgain: () => void;
  header: ReactNode;
}

export function AnswerReviewPending({
  error,
  onRecordAgain,
  header,
}: AnswerReviewPendingProps) {
  return (
    <div>
      {header}

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
          <ActionButton
            label={hub.answer.recordAgain}
            variant="secondary"
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
