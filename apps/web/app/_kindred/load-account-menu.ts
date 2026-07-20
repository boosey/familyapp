import "server-only";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import { listFamiliesStewardedBy } from "@chronicle/core";
import { isClerkConfigured } from "@/lib/clerk-config";
import { hub } from "@/app/_copy";
import type { AccountMenuItem } from "./KindredAccountMenu";
import { logOut } from "./account-menu-actions";

/**
 * The resolved account-menu model — everything the account UI needs, computed ONCE on the server by
 * the hub page and handed to BOTH presentations without duplicating the steward/person queries:
 *  - the desktop avatar dropdown (`AccountMenuClient`, rendered by HubPrimaryNav at the right end of
 *    the hub's tabs row), and
 *  - the bottom nav bar's 5th "Account" item on a phone (ADR-0025 device round — the avatar moved off
 *    the top-right into the bottom bar so the control strip reclaims one full-width row; issue #233).
 *
 * The former global {@link AccountMenuMount} (a root-layout copy of this load) was removed in #234 —
 * it duplicated every query on each `/hub` render. Note this means non-hub authenticated screens no
 * longer render an account menu; re-adding one there means calling this loader in that screen.
 */
export interface AccountMenu {
  /** Up-to-two-letter monogram for the avatar disc. */
  initials: string;
  /** The viewer's display name (menu header); null when unknown. */
  viewerName: string | null;
  /** Profile / Settings / (steward family settings) / Create / Find / Log out. */
  items: AccountMenuItem[];
  /** Whether the log-out row must use the Clerk sign-out path (only when ClerkProvider is mounted). */
  clerkSignOut: boolean;
}

/** Resolve the account menu for the current viewer. The logic originally lived inline in the
 *  (since removed) global AccountMenuMount; it now serves the bottom-bar account item only. */
export async function loadAccountMenu(
  db: Parameters<typeof listFamiliesStewardedBy>[0],
  personId: string,
): Promise<AccountMenu> {
  const [row] = await db
    .select({ spokenName: persons.spokenName, displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, personId))
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

  // Steward-only Edit-a-Family entries (#54): one per stewarded family, above "Create a family". One
  // stewarded family → a generic "Family settings" label; two or more are disambiguated by name.
  const stewarded = await listFamiliesStewardedBy(db, personId);
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
          // `||` (not `??`): a blank short name falls back to the formal name, not a " settings" label.
          label: hub.shell.menuFamilySettingsNamed(f.shortName || f.name),
          href: `/families/${f.familyId}/edit`,
        }));

  const items: AccountMenuItem[] = [
    { key: "profile", label: hub.shell.menuProfile, href: "/hub/profile" },
    { key: "settings", label: hub.shell.menuSettings, href: "/hub/settings" },
    { key: "switch-user", label: hub.shell.menuSwitchUser, href: "/dev/sign-in" },
    ...familyEditItems,
    { key: "create-family", label: hub.shell.menuCreateFamily, href: "/families/new" },
    { key: "find-family", label: hub.shell.menuFindFamily, href: "/families/find" },
    { key: "log-out", label: hub.shell.menuLogOut, onSelect: logOut },
  ];

  return { initials, viewerName, items, clerkSignOut: isClerkConfigured() };
}
