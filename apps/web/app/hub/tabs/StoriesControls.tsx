"use client";

/**
 * StoriesControls — the single compact control row for the Stories tab (#125), sitting directly below
 * the tab bar and above every feed/empty branch. Left-to-right it holds: the family-filter chips (≥2
 * families only), a compact draft-reminder button (only when the viewer has ask-less drafts still in
 * review), and a right-justified "Tell a story" link — the tab's single Tell-a-story affordance.
 *
 * A client component because the draft-reminder expands its per-draft resume list in place (useState).
 * All authorization already happened upstream; this only renders what the server producer handed down.
 */
import { useId, useState } from "react";
import Link from "next/link";
import { FamilyChips } from "../FamilyChips";
import { hub } from "@/app/_copy";
import { relativeShortDate } from "@/lib/relative-time";
import type { ViewerFamily } from "./story-browse-types";
import styles from "./StoriesTab.module.css";

/** A self-initiated (ask-less) draft still in review — resumable from the Stories tab. recordedAt is
 *  an ISO string (serialized by the server component, matching the answer-drafts serialization). */
export interface SelfDraft {
  storyId: string;
  kind: "voice" | "text";
  recordedAt: string;
}

interface StoriesControlsProps {
  /**
   * The viewer's ACTIVE families (id + name), in the SAME set/order the `filter` was parsed against.
   * Drives the family-filter chips — mounted ONLY for a viewer with ≥2 families (one family has
   * nothing to filter), matching the server-side gate the tab used to apply.
   */
  activeFamilies: ViewerFamily[];
  /** The chips' selected value: "all" (every chip ON) or the concrete selected-id set. */
  selected: string[] | "all";
  /** The viewer's own ask-less drafts still awaiting approval — the compact reminder + resume list. */
  selfDrafts: SelfDraft[];
}

export function StoriesControls({ activeFamilies, selected, selfDrafts }: StoriesControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const hasDrafts = selfDrafts.length > 0;

  // The chip bar mounts only for a viewer with ≥2 families (one family has nothing to filter). Gating
  // the MOUNT here keeps FamilyChips' next/navigation hooks out of the render for the 0/1-family case.
  const chips =
    activeFamilies.length >= 2 ? (
      <FamilyChips inline families={activeFamilies} selected={selected} />
    ) : null;

  return (
    <>
      <div className={styles.controlRow}>
        {chips}

        {/* Compact draft-reminder — matches the control height, two short stacked lines. Toggles the
            per-draft resume list below the row. */}
        {hasDrafts ? (
          <button
            type="button"
            className={styles.draftButton}
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((v) => !v)}
          >
            <span className={styles.draftButtonTop}>{hub.stories.draftReminder(selfDrafts.length)}</span>
            <span className={styles.draftButtonAction}>{hub.stories.draftReminderAction}</span>
          </button>
        ) : null}

        <Link href="/hub/tell" className={styles.tellButton}>
          {hub.stories.tellTitle}
        </Link>
      </div>

      {/* Resume: the viewer's own ask-less drafts still in review. Each links to /hub/tell/[storyId].
          Rendered only when the reminder is expanded (and drafts exist). */}
      {hasDrafts && expanded ? (
        <ul id={listId} className={styles.resumeList}>
          {selfDrafts.map((d) => (
            <li key={d.storyId} className={styles.resumeItem}>
              <span className={styles.resumeMeta}>
                {hub.questions.recordedAt(relativeShortDate(d.recordedAt))}
              </span>
              <Link href={`/hub/tell/${d.storyId}`} className={styles.resumeLink}>
                {hub.stories.resume}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
