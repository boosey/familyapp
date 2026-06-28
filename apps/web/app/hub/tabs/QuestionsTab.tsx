import type { PendingAskForElder } from "@chronicle/core";
import { AnswerButton } from "./AnswerButton";

interface QuestionsTabProps {
  asks: PendingAskForElder[];
}

/**
 * Questions tab — the asks routed to the viewer as the target elder. Hi-fi per the "To answer"
 * panel in the Family Chronicle design: a serif heading + gentle subtitle, then one card per
 * question with the asker, the question, and an Answer affordance. Server component.
 */
export function QuestionsTab({ asks }: QuestionsTabProps) {
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
        Questions for you
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
        Your family asked these. Answer whenever you’re ready — there’s no rush.
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
            You’re all caught up. Nothing waiting.
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
          {asks.map((item) => (
            <li
              key={item.ask.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                background: "var(--surface-card)",
                border: "var(--border-width) solid var(--border)",
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
                  {item.askerSpokenName.toUpperCase()} ASKED
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
              </div>
              <AnswerButton />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
