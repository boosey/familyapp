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
 *   - `processing` — the story is still `draft` and the pipeline is (as far as the DB knows) running.
 *   - `ready`      — the story reached `pending_approval` (or beyond): prose is populated and the
 *                    review/approve surface can render.
 *   - `failed`     — the story is still `draft` BUT a durable-job stage exhausted its retries and
 *                    stamped a failure signal (`processingFailedAt`, issue #11). The UI can now tell
 *                    "permanently failed" from "still slow" and offer a retry instead of spinning.
 *
 * Any non-draft state maps to `ready`: once a story leaves `draft` it has been rendered, so the
 * reviewer should stop polling (a stale failure marker is ignored — the render clearly succeeded).
 */
import type { Story } from "@chronicle/db";

export type AnswerStatus = "processing" | "ready" | "failed";

export function mapStoryStateToStatus(
  story: Pick<Story, "state" | "processingFailedAt">,
): AnswerStatus {
  if (story.state !== "draft") return "ready";
  return story.processingFailedAt !== null ? "failed" : "processing";
}
