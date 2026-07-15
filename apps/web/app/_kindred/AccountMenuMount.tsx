import "server-only";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import { listFamiliesStewardedBy } from "@chronicle/core";
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

  // Steward-only Edit-a-Family entry points (#54): one per family the viewer stewards, sitting just
  // above "Create a family". A single stewarded family gets a generic "Family settings" label; two or
  // more are disambiguated by name. A viewer who stewards none sees no edit entry.
  const stewarded = await listFamiliesStewardedBy(db, ctx.personId);
  const familyEditItems: AccountMenuItem[] =
    stewarded.length === 1
      ? [
          {
            key: "family-settings",
            label: hub.shell.menuFamilySettings,
            href: `/families/${stewarded[0]!.familyId}/edit`,
          },
        ]
      : stewarded.map((f) => ({
          key: `family-settings-${f.familyId}`,
          // `||` (not `??`): a blank short name ("" — should never persist, the write path coerces
          // "" → null, but defend anyway) falls back to the formal name, not a " settings" label.
          label: hub.shell.menuFamilySettingsNamed(f.shortName || f.name),
          href: `/families/${f.familyId}/edit`,
        }));

  const items: AccountMenuItem[] = [
    { key: "profile", label: hub.shell.menuProfile, href: "/hub/profile" },
    { key: "settings", label: hub.shell.menuSettings, href: "/hub/settings" },
    { key: "switch-user", label: hub.shell.menuSwitchUser, href: "/dev/sign-in" },
    // Family actions — moved off the retired hub scope pill (ADR-0021). Universal: they work for a
    // no-family or single-family viewer, who never see a family-filter chip bar.
    ...familyEditItems,
    { key: "create-family", label: hub.shell.menuCreateFamily, href: "/families/new" },
    { key: "find-family", label: hub.shell.menuFindFamily, href: "/families/find" },
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
