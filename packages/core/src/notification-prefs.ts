/**
 * Person-global Notification stream preferences. Channel-agnostic (email/SMS later honor the
 * same frequency). Invites are outside streams. Absent row ⇒ every_item.
 */
import { and, eq } from "drizzle-orm";
import { notificationStreamPrefs } from "@chronicle/db/schema";
import type {
  Database,
  NotificationFrequency,
  NotificationStream,
  NotificationStreamPref,
} from "@chronicle/db";

export const NOTIFICATION_STREAMS = [
  "questions_for_me",
  "answers_to_my_asks",
  "family_activity",
] as const satisfies readonly NotificationStream[];

export const DEFAULT_NOTIFICATION_FREQUENCY: NotificationFrequency = "every_item";

/** Effective frequency for one stream (absent row → every_item). */
export async function getNotificationStreamFrequency(
  db: Database,
  personId: string,
  stream: NotificationStream,
): Promise<NotificationFrequency> {
  const [row] = await db
    .select({ frequency: notificationStreamPrefs.frequency })
    .from(notificationStreamPrefs)
    .where(
      and(
        eq(notificationStreamPrefs.personId, personId),
        eq(notificationStreamPrefs.stream, stream),
      ),
    )
    .limit(1);
  return row?.frequency ?? DEFAULT_NOTIFICATION_FREQUENCY;
}

/** Upsert Person × stream frequency. */
export async function setNotificationStreamFrequency(
  db: Database,
  personId: string,
  stream: NotificationStream,
  frequency: NotificationFrequency,
): Promise<NotificationStreamPref> {
  const [row] = await db
    .insert(notificationStreamPrefs)
    .values({ personId, stream, frequency })
    .onConflictDoUpdate({
      target: [notificationStreamPrefs.personId, notificationStreamPrefs.stream],
      set: { frequency, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

/** All three streams with defaults filled for any missing rows. */
export async function listNotificationStreamFrequencies(
  db: Database,
  personId: string,
): Promise<Record<NotificationStream, NotificationFrequency>> {
  const rows = await db
    .select({
      stream: notificationStreamPrefs.stream,
      frequency: notificationStreamPrefs.frequency,
    })
    .from(notificationStreamPrefs)
    .where(eq(notificationStreamPrefs.personId, personId));

  const result = {
    questions_for_me: DEFAULT_NOTIFICATION_FREQUENCY,
    answers_to_my_asks: DEFAULT_NOTIFICATION_FREQUENCY,
    family_activity: DEFAULT_NOTIFICATION_FREQUENCY,
  } satisfies Record<NotificationStream, NotificationFrequency>;

  for (const row of rows) {
    result[row.stream] = row.frequency;
  }
  return result;
}
