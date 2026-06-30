/**
 * The viewer-scoped processing-status contract (issue #2, slice 2b).
 *
 * With the durable Inngest queue (slice 2a), a capture request can return while the story is still
 * `draft` — transcribe→render run out-of-band, so the story reaches `pending_approval` later. The
 * capture UIs need a small, audited way to ask "is my story ready to review yet?" without learning
 * anything about the story's content. This module is the pure state→status mapping; both surfaces
 * (hub account-auth + link-session token) feed it the result of a @chronicle/core front-door read
 * (`getStoryForViewer`) — they NEVER touch the `stories` table directly.
 *
 *   - `processing` — the story is still `draft` (the pipeline has not finished rendering prose).
 *   - `ready`      — the story reached `pending_approval` (or beyond): prose is populated and the
 *                    review/approve surface can render.
 *
 * Any non-draft state maps to `ready`: once a story leaves `draft` it has been rendered, so the
 * reviewer should stop polling. (A `draft` that never advances — e.g. an Inngest stage that
 * exhausted its retries — leaves no DB error signal, so the UI cannot distinguish "failed" from
 * "slow"; the poll callers cap their wait and show a soft message rather than spinning forever.)
 */
import type { StoryState } from "@chronicle/db";

export type AnswerStatus = "processing" | "ready";

export interface AnswerStatusResult {
  status: AnswerStatus;
  storyId: string;
}

export function mapStoryStateToStatus(state: StoryState): AnswerStatus {
  return state === "draft" ? "processing" : "ready";
}
