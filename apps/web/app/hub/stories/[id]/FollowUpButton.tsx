"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { askFollowUpAction } from "./actions";
import { hub } from "@/app/_copy";
import { FOLLOW_UP_QUESTION_MAX_CHARS } from "@/lib/constants";

export interface FollowUpButtonProps {
  /** The published story the follow-up is about (stamped onto the ask's `source_story_id`). */
  storyId: string;
  /** The narrator (story owner) the follow-up routes to. */
  targetPersonId: string;
  /** The narrator's spoken name — used in the panel heading. */
  narratorName: string;
}

// Static — hoisted out of the component so it is not re-allocated on every render (depends on no
// props/state).
const buttonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm, 1.125rem)",
  fontWeight: 600,
  background: "transparent",
  border: "1.5px solid var(--border)",
  borderRadius: "var(--radius-pill, 9999px)",
  padding: "6px 16px",
  color: "var(--text-muted)",
  cursor: "pointer",
  transition: "background 0.15s, border-color 0.15s, color 0.15s",
  outline: "none",
};

/**
 * "Ask a follow-up" affordance on a published story (#77). Any authorized viewer (a member who can
 * SEE the story) can pose a further question tied to it; it routes into the EXISTING ask queue via
 * `askFollowUpAction` → `createAsk({ sourceStoryId })` and surfaces in the narrator's next session.
 * The button toggles an inline form; on success it shows a confirmation instead of the form.
 */
export function FollowUpButton({ storyId, targetPersonId, narratorName }: FollowUpButtonProps) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!question.trim()) {
      setError(hub.followUp.empty);
      return;
    }
    const fd = new FormData();
    fd.append("storyId", storyId);
    fd.append("targetPersonId", targetPersonId);
    fd.append("questionText", question);

    startTransition(async () => {
      try {
        const res = await askFollowUpAction(fd);
        if (res?.error) {
          setError(res.error);
        } else {
          setSent(true);
          setOpen(false);
          setQuestion("");
        }
      } catch {
        // A rejected server action (network failure, unhandled server error) would otherwise leave
        // the transition resolved but the form stuck with no feedback. Surface a retry-able error.
        setError(hub.followUp.failed);
      }
    });
  };

  if (sent) {
    return (
      <p
        data-testid="follow-up-sent"
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--accent-strong)",
          margin: 0,
        }}
      >
        {hub.followUp.sent}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="follow-up-open"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        style={buttonStyle}
      >
        <span aria-hidden style={{ fontSize: "1.1rem" }}>
          💬
        </span>
        <span>{hub.followUp.open}</span>
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="follow-up-form"
      style={{
        display: "grid",
        gap: 12,
        width: "100%",
        maxWidth: 480,
        padding: 16,
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg, 12px)",
      }}
    >
      <h3
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg, 1.25rem)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: 0,
        }}
      >
        {hub.followUp.heading(narratorName)}
      </h3>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-muted)",
          margin: 0,
        }}
      >
        {hub.followUp.intro}
      </p>
      <label className="kin-form-label">
        {hub.followUp.label}
        <textarea
          name="questionText"
          className="kin-field"
          rows={4}
          maxLength={FOLLOW_UP_QUESTION_MAX_CHARS}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={hub.followUp.placeholder}
          disabled={isPending}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "follow-up-error" : undefined}
        />
      </label>
      {error && (
        <p
          id="follow-up-error"
          role="alert"
          data-testid="follow-up-error"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-danger, #d32f2f)",
            margin: 0,
          }}
        >
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={isPending}
          style={{
            padding: "8px 16px",
            borderRadius: "var(--radius-pill, 999px)",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {hub.followUp.cancel}
        </button>
        <button
          type="submit"
          disabled={isPending}
          style={{
            padding: "8px 20px",
            borderRadius: "var(--radius-pill, 999px)",
            border: "none",
            background: "var(--accent-strong)",
            color: "white",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {isPending ? hub.followUp.sending : hub.followUp.submit}
        </button>
      </div>
    </form>
  );
}
