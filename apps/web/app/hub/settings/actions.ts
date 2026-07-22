"use server";

import type { NotificationFrequency, NotificationStream } from "@chronicle/db";
import { getRuntime } from "@/lib/runtime";
import { NOTIFICATION_STREAMS, setNotificationStreamFrequency } from "@/lib/notification-prefs";

type SaveResult =
  | { ok: true }
  | { error: "not_signed_in" | "invalid_stream" | "invalid_frequency" | "save_failed" };

// The settings UI only offers every_item|off today (digest cadences aren't built yet), so the
// action rejects any other NotificationFrequency even though the DB type allows more values.
const UI_FREQUENCIES = new Set<NotificationFrequency>(["every_item", "off"]);
const STREAMS = new Set<string>(NOTIFICATION_STREAMS);

async function requireAccount(): Promise<
  { db: Awaited<ReturnType<typeof getRuntime>>["db"]; personId: string } | { error: "not_signed_in" }
> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: "not_signed_in" };
  return { db, personId: ctx.personId };
}

export async function saveNotificationStreamFrequencyAction(
  stream: NotificationStream,
  frequency: NotificationFrequency,
): Promise<SaveResult> {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  if (!STREAMS.has(stream)) return { error: "invalid_stream" };
  if (!UI_FREQUENCIES.has(frequency)) return { error: "invalid_frequency" };
  try {
    await setNotificationStreamFrequency(ctx.db, ctx.personId, stream, frequency);
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}
