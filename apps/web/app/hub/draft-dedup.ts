// apps/web/app/hub/draft-dedup.ts
// Dedup for the Questions-tab per-ask draft lookup.
//
// Before ADR-0007's refactor, the Questions tab consumed `listOutstandingAnswerDrafts`, which
// guaranteed ONE draft per ask — the LATEST take (it iterated most-recent-first and kept the first
// row seen per ask). The hub now reads the general `listOutstandingDrafts` and splits it, so this
// helper preserves that exact latest-wins dedup: QuestionsTab must stay byte-for-byte unchanged.
import type { OutstandingDraft } from "@chronicle/core";

/** The per-ask draft pointer QuestionsTab renders (recordedAt stays a Date — no serialization). */
export interface AskDraftInfo {
  storyId: string;
  recordedAt: Date;
}

/**
 * The ask-backed drafts the Questions tab may surface. Two gates, both required:
 *   - `askId !== null` — self-initiated tellings belong to the Stories tab, never here.
 *   - `state === "pending_approval"` — only review-ready answers. Since ADR-0014 widened the base
 *     read (`listOutstandingDrafts`) to include the live `draft` state, an ask answer still being
 *     composed would otherwise leak into the Questions tab. This mirrors `listOutstandingAnswerDrafts`'
 *     pending_approval-only contract for the hub, which reads the raw base list and splits inline.
 * Order-preserving (keeps the caller's most-recent-first ordering for `latestDraftPerAsk`).
 */
export function questionsTabAnswerDrafts(drafts: OutstandingDraft[]): OutstandingDraft[] {
  return drafts.filter((d) => d.askId !== null && d.state === "pending_approval");
}

/**
 * Keyed by Ask id, the latest draft per ask. `drafts` MUST be most-recent-first (as
 * `listOutstandingDrafts` returns), so keeping the FIRST occurrence per ask = the latest take.
 * Self-initiated drafts (`askId === null`) are excluded.
 */
export function latestDraftPerAsk(drafts: OutstandingDraft[]): Record<string, AskDraftInfo> {
  const byAsk: Record<string, AskDraftInfo> = {};
  for (const d of drafts) {
    if (d.askId !== null && !(d.askId in byAsk)) {
      byAsk[d.askId] = { storyId: d.storyId, recordedAt: d.recordedAt };
    }
  }
  return byAsk;
}
