/**
 * /hub/settings — RELOCATED (ADR-0029). The device-local app preferences moved to the Account panel's
 * Appearance section, and the notification-stream preferences to its Notifications section. This route
 * is kept as a permanent redirect so existing deep links (avatar menu history, bookmarks) keep working.
 */
import { permanentRedirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  permanentRedirect("/hub/account/appearance");
}
