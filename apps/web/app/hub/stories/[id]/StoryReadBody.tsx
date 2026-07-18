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
 *
 * Highlight-to-treasure (Task 8): when `canTreasure` + `onTreasure` are supplied, dragging across the
 * prose fires `onTreasure(selectedText)` (wired by the parent to the existing Like path — a SET) and
 * flashes a transient highlighter wash over the whole prose blob.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTreasureHighlight } from "./useTreasureHighlight";
import styles from "./StoryReadBody.module.css";

// Module-scope no-op so `onTreasure ?? NOOP` keeps a STABLE identity across renders — otherwise the
// hook's effect (which depends on the callback) would re-bind its listeners on every render.
const NOOP = () => {};

// How long the highlighter swipe lingers after a treasure, in ms.
const FLASH_MS = 650;

export type StoryReadBodyProps = {
  prose: string | null;
  transcript: string | null;
  labels: {
    story: string;
    transcript: string;
    noProse: string;
  };
  onTreasure?: (text: string) => void;
  canTreasure?: boolean;
  treasureLabels?: { hint: string; aria: string };
};

type Tab = "prose" | "transcript";

export function StoryReadBody({
  prose,
  transcript,
  labels,
  onTreasure,
  canTreasure,
  treasureLabels,
}: StoryReadBodyProps) {
  const hasProse = Boolean(prose && prose.trim());
  const hasTranscript = Boolean(transcript && transcript.trim());

  const tabs: Tab[] = [];
  if (hasProse) tabs.push("prose");
  if (hasTranscript) tabs.push("transcript");

  const [active, setActive] = useState<Tab>(tabs[0] ?? "prose");

  // Ref lives on the STABLE outer wrapper, NOT the conditional prose <p>. RATIONALE: the prose <p>
  // mounts/unmounts on the prose↔transcript tab toggle; a ref on it would leave the mouseup/touchend
  // listeners bound to a detached node after a round-trip toggle (the hook's effect deps don't change
  // on toggle, so it never re-binds). The stable wrapper avoids that stale-listener bug, and the
  // hook's `el.contains(range.commonAncestorContainer)` check still scopes selection to whatever body
  // is rendered. A deliberate refinement of the plan's "attach to the <p> blob" wording.
  const proseRef = useRef<HTMLDivElement>(null);
  const enabled = Boolean(canTreasure && onTreasure);

  // Transient, React-SAFE highlighter swipe: we flip a flag class on the prose <p> (no DOM mutation /
  // range wrapping that would fight React reconciliation) and clear it after FLASH_MS.
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    };
  }, []);

  // Stable across renders (deps: only `onTreasure`; `setFlash` + the timer ref are stable) so the hook
  // doesn't re-bind its listeners on every render — the whole point of the NOOP/useCallback stability.
  const handleTreasure = useCallback(
    (text: string) => {
      onTreasure?.(text);
      setFlash(true);
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), FLASH_MS);
    },
    [onTreasure],
  );

  // Gate the gesture off on the transcript tab (and the empty/noProse branch): the ref sits on the
  // stable wrapper that contains BOTH bodies, so without a tab check a drag over transcript text would
  // silently fire a Like with no visible flash (the flash class only lands on the prose <p>). The hook
  // re-binds cleanly on tab change because this arg is in its effect dep array.
  const gestureOn = enabled && active !== "transcript" && hasProse;
  useTreasureHighlight(proseRef, gestureOn, gestureOn ? handleTreasure : NOOP);

  const proseClassName = flash ? `${styles.prose} ${styles.treasure}` : styles.prose;

  return (
    <div
      ref={proseRef}
      role={enabled ? "region" : undefined}
      aria-label={enabled ? treasureLabels?.aria : undefined}
    >
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

      {enabled && treasureLabels && active !== "transcript" && hasProse && (
        <p className={styles.treasureHint}>{treasureLabels.hint}</p>
      )}

      {active === "transcript" && hasTranscript ? (
        <p className={styles.transcript}>{transcript}</p>
      ) : hasProse ? (
        <p className={proseClassName}>{prose}</p>
      ) : (
        <p className={`${styles.prose} ${styles.proseEmpty}`}>{labels.noProse}</p>
      )}
    </div>
  );
}
