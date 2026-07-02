"use client";

/**
 * The Read view's body: a Prose ↔ Transcript segmented toggle above the story text.
 * Client-only because the toggle is interactive; the page (a server component) hands it the
 * already-authorized prose/transcript strings plus the localized labels. It never fetches.
 *
 * Graceful degradation: tabs are content-driven. Two tabs (toggle shown) only when BOTH prose and
 * transcript exist; a single available body renders on its own with no toggle; when neither exists
 * we fall back to the "no prose yet" line (the recording above is then the whole story).
 */
import { useState } from "react";

export type StoryReadBodyProps = {
  prose: string | null;
  transcript: string | null;
  labels: {
    story: string;
    transcript: string;
    noProse: string;
  };
};

type Tab = "prose" | "transcript";

const proseStyle: React.CSSProperties = {
  fontFamily: "var(--font-story)",
  fontWeight: 400,
  fontSize: "clamp(var(--text-story), 2.5vw, var(--text-story-lg))",
  lineHeight: 1.65,
  color: "var(--text-body)",
  whiteSpace: "pre-wrap",
  textWrap: "pretty",
  margin: "0 0 60px",
};

const transcriptStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-ui-sm)",
  lineHeight: 1.7,
  color: "var(--text-muted)",
  whiteSpace: "pre-wrap",
  textWrap: "pretty",
  margin: "0 0 60px",
};

export function StoryReadBody({ prose, transcript, labels }: StoryReadBodyProps) {
  const hasProse = Boolean(prose && prose.trim());
  const hasTranscript = Boolean(transcript && transcript.trim());

  const tabs: Tab[] = [];
  if (hasProse) tabs.push("prose");
  if (hasTranscript) tabs.push("transcript");

  const [active, setActive] = useState<Tab>(tabs[0] ?? "prose");

  return (
    <div>
      {tabs.length >= 2 && (
        <div
          role="tablist"
          aria-label={`${labels.story} / ${labels.transcript}`}
          style={{
            display: "inline-flex",
            gap: 4,
            background: "var(--surface-sunken)",
            border: "1.5px solid var(--border)",
            borderRadius: "var(--radius-pill)",
            padding: 4,
            margin: "0 0 20px",
          }}
        >
          {tabs.map((tab) => {
            const on = active === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActive(tab)}
                style={{
                  padding: "9px 20px",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: "var(--radius-pill)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-ui-sm)",
                  fontWeight: 600,
                  background: on ? "var(--surface-card)" : "transparent",
                  color: on ? "var(--accent-strong)" : "var(--text-muted)",
                  boxShadow: on ? "var(--shadow-sm)" : "none",
                }}
              >
                {tab === "prose" ? labels.story : labels.transcript}
              </button>
            );
          })}
        </div>
      )}

      {active === "transcript" && hasTranscript ? (
        <p style={transcriptStyle}>{transcript}</p>
      ) : hasProse ? (
        <p style={proseStyle}>{prose}</p>
      ) : (
        <p style={{ ...proseStyle, color: "var(--text-muted)" }}>{labels.noProse}</p>
      )}
    </div>
  );
}
