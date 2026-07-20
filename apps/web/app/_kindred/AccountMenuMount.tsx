import "server-only";
import { getRuntime } from "@/lib/runtime";
import { loadAccountMenu } from "./load-account-menu";
import { AccountMenuClient } from "./AccountMenuClient";

/**
 * Global account-menu mount — one instance, rendered once from the root layout so the avatar/log-out
 * menu is reachable on EVERY authenticated screen (not just /hub). It resolves auth itself and
 * self-gates: a non-account visitor (anonymous, or a login-free /s/[token] link-session) renders
 * nothing, so mounting it unconditionally in the root layout is safe on the landing and auth pages.
 *
 * The resolved menu (initials + items + clerk flag) is built by the shared {@link loadAccountMenu} so
 * the bottom nav bar's mobile "Account" item renders the SAME entries (ADR-0025 device round, #233).
 * {@link AccountMenuClient} shows the fixed top-right dropdown on DESKTOP and renders nothing on a phone
 * (where the bottom bar owns the account entry).
 */
export async function AccountMenuMount() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  // Only signed-in account holders get the menu; everyone else (anonymous, link-session) sees nothing.
  if (ctx.kind !== "account") return null;

  const menu = await loadAccountMenu(db, ctx.personId);

  return (
    <AccountMenuClient
      initials={menu.initials}
      viewerName={menu.viewerName}
      items={menu.items}
      clerkSignOut={menu.clerkSignOut}
    />
  );
}
