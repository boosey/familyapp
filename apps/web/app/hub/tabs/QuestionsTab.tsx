import Link from "next/link";
import type { PendingAskForNarrator } from "@chronicle/core";
import type { OutstandingAnswerDraft } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { relativeShortDate } from "@/lib/relative-time";

interface QuestionsTabProps {
  asks: PendingAskForNarrator[];
  /** Keyed by Ask id. Presence signals a recorded-but-unapproved draft exists for that ask. */
  draftsByAskId: Record<string, Pick<OutstandingAnswerDraft, "storyId" | "recordedAt">>;
}

/**
 * Questions tab — the asks routed to the viewer as the target narrator. Two-state per ask:
 * "Answer" (no draft recorded yet) and "Review & approve" (draft exists). Both states link to
 * /hub/answer/[askId] — the full-screen in-hub record→review page. Server component.
 */
export function QuestionsTab({ asks, draftsByAskId }: QuestionsTabProps) {
  return (
    <div>
      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story-lg)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: 0,
        }}
      >
        {hub.questions.title}
      </h2>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          lineHeight: "var(--leading-body)",
          color: "var(--text-muted)",
          margin: "12px 0 0",
        }}
      >
        {hub.questions.intro}
      </p>

      {asks.length === 0 ? (
        <div
          style={{
            marginTop: 24,
            background: "var(--surface-card)",
            border: "var(--border-width) solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: 30,
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story)",
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            {hub.questions.caughtUp}
          </p>
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "24px 0 0",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {asks.map((item) => {
            const draft = draftsByAskId[item.ask.id];
            const hasDraft = Boolean(draft);

            // Short relative date for the "Recorded X ago" sub-label
            const recordedLabel = draft ? relativeShortDate(draft.recordedAt) : null;

            return (
              <li
                key={item.ask.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 20,
                  background: "var(--surface-card)",
                  border: `var(--border-width) solid ${hasDraft ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "var(--shadow-card)",
                  padding: "20px 24px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-label)",
                      color: "var(--text-meta)",
                      letterSpacing: "var(--tracking-mono)",
                    }}
                  >
                    {hub.questions.askedBy(item.askerSpokenName)}
                  </span>
                  <p
                    style={{
                      fontFamily: "var(--font-story)",
                      fontSize: "var(--text-story)",
                      lineHeight: "var(--leading-snug)",
                      color: "var(--text-body)",
                      margin: "6px 0 0",
                    }}
                  >
                    {item.ask.questionText}
                  </p>
                  {recordedLabel ? (
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-label)",
                        color: "var(--support)",
                        letterSpacing: "var(--tracking-mono)",
                        margin: "6px 0 0",
                      }}
                    >
                      {hub.questions.recordedAt(recordedLabel)}
                    </p>
                  ) : null}
                </div>

                <Link
                  href={`/hub/answer/${item.ask.id}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "12px 22px",
                    borderRadius: "var(--radius-md)",
                    border: hasDraft ? `1.5px solid var(--accent)` : "none",
                    background: hasDraft ? "var(--accent-soft)" : "var(--accent)",
                    color: hasDraft ? "var(--accent)" : "var(--accent-on)",
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-ui-sm)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    textDecoration: "none",
                  }}
                >
                  {hasDraft ? hub.questions.reviewApprove : hub.questions.answer}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
