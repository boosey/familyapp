/**
 * /hub/profile — RELOCATED (ADR-0029). The identity/anchor editor now lives in the Account panel as
 * the Profile section. This route is kept as a permanent redirect so existing deep links (avatar menu
 * history, bookmarks, docs) keep working.
 */
import { permanentRedirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ProfilePage() {
  permanentRedirect("/hub/account/profile");
}
