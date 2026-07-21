/**
 * Deliver "story landed" / "question answered" emails after a story is shared (#270 / C13b).
 * Best-effort per recipient; never throws on partial notifier failure.
 */
import type { Database } from "@chronicle/db";
import { listStorySharedPingRecipients } from "@chronicle/core";
import type { Notifier } from "@chronicle/notifications";
import { loopPings } from "@/app/_copy/loop-pings";

export async function deliverStorySharedPings(args: {
  db: Database;
  notifier: Notifier;
  storyId: string;
  origin: string;
}): Promise<void> {
  const ctx = await listStorySharedPingRecipients(args.db, args.storyId);
  if (ctx.recipients.length === 0) return;

  const narratorName = ctx.narratorDisplayName ?? "Someone in your family";
  const link = `${args.origin.replace(/\/$/, "")}/hub/stories/${args.storyId}`;

  for (const recipient of ctx.recipients) {
    const copy =
      recipient.kind === "asker" ? loopPings.asker : loopPings.family;
    try {
      await args.notifier.send({
        channel: "email",
        to: recipient.email,
        subject: copy.subject(narratorName),
        text: copy.text(narratorName, ctx.storyTitleOrNull, link),
      });
    } catch {
      // Best-effort: one recipient failure must not block the rest.
    }
  }
}
