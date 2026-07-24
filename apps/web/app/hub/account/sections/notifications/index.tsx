/**
 * Account › Notifications (ADR-0029) — the account-level notification-stream preferences (3 streams ×
 * frequency), persisted via `notificationStreamPrefs` and synced cross-device. Relocated from
 * /hub/settings. Loads the viewer's current frequencies with the shared db handle and hands them to
 * the client control. Section copy lives in `./copy.ts`.
 */
import { listNotificationStreamFrequencies } from "@/lib/notification-prefs";
import type { AccountSectionProps } from "../../section-props";
import { NotificationsSection } from "./NotificationsSection";

export default async function NotificationsAccountSection({ personId, db }: AccountSectionProps) {
  const frequencies = await listNotificationStreamFrequencies(db, personId);
  return <NotificationsSection initialFrequencies={frequencies} />;
}
