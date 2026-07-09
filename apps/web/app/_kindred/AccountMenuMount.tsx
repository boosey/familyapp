import "server-only";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";
import { isClerkConfigured } from "@/lib/clerk-config";
import { hub } from "@/app/_copy";
import { KindredAccountMenu } from "./KindredAccountMenu";
import type { AccountMenuItem } from "./KindredAccountMenu";
import { logOut } from "./account-menu-actions";

/**
 * Global account-menu mount — one instance, rendered once from the root layout so the avatar/log-out
 * menu is reachable on EVERY authenticated screen (not just /hub). It resolves auth itself and
 * self-gates: a non-account visitor (anonymous, or a login-free /s/[token] link-session) renders
 * nothing, so mounting it unconditionally in the root layout is safe on the landing and auth pages.
 *
 * The menu logic mirrors what the hub header used to inline; the hub no longer renders its own copy
 * (the fixed-position mount covers it too). It is positioned `fixed` top-right and floats above each
 * screen's own header/back-nav — those keep the left side clear.
 */
export async function AccountMenuMount() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  // Only signed-in account holders get the menu; everyone else (anonymous, link-session) sees nothing.
  if (ctx.kind !== "account") return null;

  const [row] = await db
    .select({ spokenName: persons.spokenName, displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, ctx.personId))
    .limit(1);

  const viewerName = row?.spokenName ?? row?.displayName ?? null;
  const initials = viewerName
    ? viewerName
        .split(" ")
        .map((w) => w[0] ?? "")
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "Y";

  const items: AccountMenuItem[] = [
    { key: "profile", label: hub.shell.menuProfile, href: "/hub/profile" },
    { key: "settings", label: hub.shell.menuSettings, href: "/hub/settings" },
    { key: "switch-user", label: hub.shell.menuSwitchUser, href: "/dev/sign-in" },
    { key: "log-out", label: hub.shell.menuLogOut, onSelect: logOut },
  ];

  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 50 }}>
      <KindredAccountMenu
        initials={initials}
        displayName={viewerName ?? undefined}
        items={items}
        clerkSignOut={isClerkConfigured()}
      />
    </div>
  );
}
