/**
 * Ask-answerability guard shared by the in-hub answer actions and the login-free
 * `/api/capture` link-session path. Confirms the ask exists, is targeted at THIS person,
 * and is still answerable (queued/routed).
 *
 * Recording into an already-answered ask would create a dead draft whose Share can never
 * close (approveAndShareStory rejects a second answer) — SF-4 — so callers must reject
 * before ingesting. Binding another person's ask is an IDOR — reject before subject-photo
 * resolve / ingest as well.
 */
import { eq } from "drizzle-orm";
import { asks } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";

export type AnswerableAskResult =
  | { ok: true; questionText: string }
  | { ok: false; reason: "not_for_you" | "already_answered" };

export async function assertAnswerableAsk(
  db: Database,
  askId: string,
  personId: string,
): Promise<AnswerableAskResult> {
  const [askRow] = await db
    .select({
      targetPersonId: asks.targetPersonId,
      status: asks.status,
      question: asks.questionText,
    })
    .from(asks)
    .where(eq(asks.id, askId))
    .limit(1);
  if (!askRow || askRow.targetPersonId !== personId) {
    return { ok: false, reason: "not_for_you" };
  }
  if (askRow.status !== "queued" && askRow.status !== "routed") {
    return { ok: false, reason: "already_answered" };
  }
  return { ok: true, questionText: askRow.question };
}
