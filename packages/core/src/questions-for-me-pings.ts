/**
 * questions-for-me outbound ping (#276) — resolve whether the askee should be emailed when an
 * Ask becomes actionable (successful `createAsk`).
 *
 * Metadata only: never returns story prose/transcript/media. Reads the OPEN `asks` table (not
 * behind the guarded content subpath — see CLAUDE.md "asks are open schema") solely for the
 * identity/question-text fields needed to address the outbound ping.
 *
 * Mirrors `listStorySharedPingRecipients` (#270 / C13b): same Person×stream prefs API
 * (`getNotificationStreamFrequency`) and the same verified-email-then-accounts.email resolution
 * (`resolvePersonEmails`). Only `off` suppresses immediate send — digest frequencies
 * (`daily_digest` / `weekly_digest`) are treated like `every_item` until digest assembly (#277)
 * exists to actually batch them.
 */
import { eq } from "drizzle-orm";
import { asks, persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import { getNotificationStreamFrequency } from "./notification-prefs";
import { resolvePersonEmails } from "./person-emails";

export interface QuestionsForMePingContext {
  askId: string;
  askeePersonId: string;
  askerDisplayName: string | null;
  questionText: string;
  /** Null when prefs off, no email, the askee is also the asker, or the ask is missing. */
  recipient: { personId: string; email: string } | null;
}

/**
 * Resolve the askee ping context for one Ask. Returns `null` ONLY when the ask row itself is
 * missing. When the ask exists but should not be emailed (self-ask, `off` prefs, no reachable
 * email), the context is still returned with `recipient: null` so callers can log/observe why.
 */
export async function resolveQuestionsForMePing(
  db: Database,
  askId: string,
): Promise<QuestionsForMePingContext | null> {
  const [ask] = await db
    .select({
      id: asks.id,
      askerPersonId: asks.askerPersonId,
      targetPersonId: asks.targetPersonId,
      questionText: asks.questionText,
    })
    .from(asks)
    .where(eq(asks.id, askId))
    .limit(1);

  if (!ask) return null;

  const [asker] = await db
    .select({
      displayName: persons.displayName,
      spokenName: persons.spokenName,
    })
    .from(persons)
    .where(eq(persons.id, ask.askerPersonId))
    .limit(1);
  const askerDisplayName = asker?.spokenName ?? asker?.displayName ?? null;

  const base: QuestionsForMePingContext = {
    askId: ask.id,
    askeePersonId: ask.targetPersonId,
    askerDisplayName,
    questionText: ask.questionText,
    recipient: null,
  };

  // Self-ask safety: never notify the asker, even if askee === asker.
  if (ask.targetPersonId === ask.askerPersonId) return base;

  const frequency = await getNotificationStreamFrequency(
    db,
    ask.targetPersonId,
    "questions_for_me",
  );
  if (frequency === "off") return base;

  const emailsByPerson = await resolvePersonEmails(db, [ask.targetPersonId]);
  const email = emailsByPerson.get(ask.targetPersonId);
  if (!email) return base;

  return { ...base, recipient: { personId: ask.targetPersonId, email } };
}
