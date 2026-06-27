import type { PendingAskForElder } from "@chronicle/core";

interface QuestionsTabProps {
  asks: PendingAskForElder[];
}

/**
 * Questions tab — renders the pending asks routed to the viewer as the target elder.
 * Server component; receives already-fetched asks from the hub shell.
 */
export function QuestionsTab({ asks }: QuestionsTabProps) {
  if (asks.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          padding: "48px 24px",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "var(--text-story-lg)",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          No questions waiting for you right now.
        </p>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          When family members ask you something, their questions will appear here.
        </p>
      </div>
    );
  }

  return (
    <ul
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {asks.map((item) => (
        <li
          key={item.ask.id}
          style={{
            background: "var(--surface-card)",
            border: "var(--border-width) solid var(--border)",
            borderRadius: "var(--radius-lg)",
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {/* From label */}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              color: "var(--text-meta)",
              letterSpacing: "var(--tracking-mono)",
            }}
          >
            FROM {item.askerSpokenName.toUpperCase()}
          </span>

          {/* Question text */}
          <p
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story)",
              lineHeight: "var(--leading-snug)",
              color: "var(--text-body)",
              margin: 0,
            }}
          >
            {item.ask.questionText}
          </p>
        </li>
      ))}
    </ul>
  );
}
