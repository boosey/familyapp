/**
 * Immediate-send gate for notification streams (#322).
 *
 * Ping resolvers call `shouldDeliverImmediately(db, personId, stream)` instead of
 * copying `frequency === "off"`. Digest assembly (#277) plugs in here: flip
 * `allowsImmediateDelivery` so `daily_digest` / `weekly_digest` return false, then
 * buffer those events for batched send instead of including them in the immediate
 * recipient list.
 */
import type { Database, NotificationFrequency, NotificationStream } from "@chronicle/db";
import { getNotificationStreamFrequency } from "./notification-prefs";

/**
 * Pure policy over a resolved frequency.
 *
 * Until #277: only `off` suppresses. Digest frequencies still allow immediate
 * delivery (same as `every_item`) so behaviour matches today's ping paths.
 */
export function allowsImmediateDelivery(frequency: NotificationFrequency): boolean {
  return frequency !== "off";
}

/**
 * Whether an event on `stream` should trigger an immediate send for this person.
 * Resolves prefs (absent → every_item) then applies {@link allowsImmediateDelivery}.
 */
export async function shouldDeliverImmediately(
  db: Database,
  personId: string,
  stream: NotificationStream,
): Promise<boolean> {
  const frequency = await getNotificationStreamFrequency(db, personId, stream);
  return allowsImmediateDelivery(frequency);
}
