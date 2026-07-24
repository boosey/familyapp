/**
 * /hub/account — the Account surface landing (ADR-0029). Redirects to the first section so the single
 * avatar-menu "Account" launcher (href: "/hub/account") lands somewhere concrete. On a wide viewport
 * the rail shows every section beside it; on narrow the drill-down opens on this first panel.
 */
import { redirect } from "next/navigation";
import { ACCOUNT_SECTIONS } from "./account-sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AccountIndexPage() {
  redirect(`/hub/account/${ACCOUNT_SECTIONS[0]!.slug}`);
}
