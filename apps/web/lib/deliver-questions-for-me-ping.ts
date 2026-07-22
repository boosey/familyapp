/**
 * Deliver the "Ask became actionable" askee email (#276). Best-effort: never throws — a delivery
 * failure must not surface to the Ask-creation call site (which wraps dispatch in try/catch, but
 * this closure stays defensive too, mirroring `deliverStorySharedPings`).
 */
import type { Database } from "@chronicle/db";
import { resolveQuestionsForMePing } from "@chronicle/core";
import type { Notifier } from "@chronicle/notifications";
import { questionsForMePings } from "@/app/_copy/questions-for-me-pings";

export async function deliverQuestionsForMePing(args: {
  db: Database;
  notifier: Notifier;
  askId: string;
  origin: string;
}): Promise<void> {
  const ctx = await resolveQuestionsForMePing(args.db, args.askId);
  if (!ctx || !ctx.recipient) return;

  const askerName = ctx.askerDisplayName ?? "Someone in your family";
  const link = `${args.origin.replace(/\/$/, "")}/hub/answer/${args.askId}`;

  try {
    await args.notifier.send({
      channel: "email",
      to: ctx.recipient.email,
      subject: questionsForMePings.subject(askerName),
      text: questionsForMePings.text(askerName, ctx.questionText, link),
    });
  } catch {
    // Best-effort: a notifier failure must not propagate.
  }
}
