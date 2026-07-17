"use client";

/**
 * The Read view's body: a Prose ↔ Transcript segmented toggle above the story text.
 * Client-only because the toggle is interactive; the page (a server component) hands it the
 * already-authorized prose/transcript strings plus the localized labels. It never fetches.
 *
 * Graceful degradation: tabs are content-driven. Two tabs (toggle shown) only when BOTH prose and
 * transcript exist; a single available body renders on its own with no toggle; when neither exists
 * we fall back to the "no prose yet" line (the recording above is then the whole story).
 *
 * Styling: token-driven CSS module (Phase 2). The prose stays a SINGLE <p> blob — highlight-to-
 * treasure (Task 8) selects across the whole prose text, so it must not be split into per-line/
 * paragraph elements.
 */
import { useState } from "react";
import styles from "./StoryReadBody.module.css";

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
        <div role="tablist" aria-label={`${labels.story} / ${labels.transcript}`} className={styles.tablist}>
          {tabs.map((tab) => {
            const on = active === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActive(tab)}
                className={styles.tab}
              >
                {tab === "prose" ? labels.story : labels.transcript}
              </button>
            );
          })}
        </div>
      )}

      {active === "transcript" && hasTranscript ? (
        <p className={styles.transcript}>{transcript}</p>
      ) : hasProse ? (
        <p className={styles.prose}>{prose}</p>
      ) : (
        <p className={`${styles.prose} ${styles.proseEmpty}`}>{labels.noProse}</p>
      )}
    </div>
  );
}
