import Link from "next/link";
import type { PendingAskForNarrator } from "@chronicle/core";
import type { OutstandingAnswerDraft } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { relativeShortDate } from "@/lib/relative-time";
import { cardTilt } from "./card-tilt";
import styles from "./QuestionsTab.module.css";

interface QuestionsTabProps {
  asks: PendingAskForNarrator[];
  /** Keyed by Ask id. Presence signals a recorded-but-unapproved draft exists for that ask. */
  draftsByAskId: Record<string, Pick<OutstandingAnswerDraft, "storyId" | "recordedAt">>;
}

/**
 * Questions tab — the asks routed to the viewer as the target narrator. Two-state per ask:
 * "Answer" (no draft recorded yet) and "Review & approve" (draft exists). Both states link to
 * /hub/answer/[askId] — the full-screen in-hub record→review page. Server component.
 *
 * Styling lives in QuestionsTab.module.css (token-driven base + skin-scoped Scrapbook signatures:
 * tilt/tape/highlighter/sticker/hover-lift, suppressed under reduce-motion / solemn). Tilt math
 * stays in TS (card-tilt) per the repo convention. See apps/web/app/_skins/CSS-MODULES.md.
 */
export function QuestionsTab({ asks, draftsByAskId }: QuestionsTabProps) {
  return (
    <div>
      <h2 className={styles.title}>{hub.questions.title}</h2>
      <p className={styles.intro}>{hub.questions.intro}</p>

      {asks.length === 0 ? (
        <div className={styles.empty} style={cardTilt(0)}>
          <p className={styles.emptyText}>{hub.questions.caughtUp}</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {asks.map((item, i) => {
            const draft = draftsByAskId[item.ask.id];
            const hasDraft = Boolean(draft);

            // Short relative date for the "Recorded X ago" sub-label
            const recordedLabel = draft ? relativeShortDate(draft.recordedAt) : null;

            return (
              <li
                key={item.ask.id}
                className={[styles.card, hasDraft ? styles.cardDraft : null]
                  .filter(Boolean)
                  .join(" ")}
                style={cardTilt(i)}
              >
                <div className={styles.cardBody}>
                  <span className={styles.askedBy}>
                    {hub.questions.askedBy(item.askerSpokenName)}
                  </span>
                  <p className={styles.question}>{item.ask.questionText}</p>
                  {recordedLabel ? (
                    <p className={styles.recorded}>{hub.questions.recordedAt(recordedLabel)}</p>
                  ) : null}
                </div>

                <Link
                  href={`/hub/answer/${item.ask.id}`}
                  className={[styles.action, hasDraft ? styles.actionDraft : null]
                    .filter(Boolean)
                    .join(" ")}
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
