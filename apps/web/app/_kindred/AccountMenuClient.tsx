"use client";

import { useIsCompact } from "./useIsCompact";
import { KindredAccountMenu } from "./KindredAccountMenu";
import type { AccountMenuItem } from "./KindredAccountMenu";

interface AccountMenuClientProps {
  initials: string;
  viewerName: string | null;
  items: AccountMenuItem[];
  clerkSignOut: boolean;
}

/**
 * ADR-0025 device round (#233) — the DESKTOP presentation of the account menu: the fixed top-right
 * avatar + dropdown, exactly as before. On a PHONE it renders NOTHING: the account entry moved into the
 * bottom nav bar (BottomTabBar's 5th item) so the control strip can reclaim a full-width row and nothing
 * floats over the top-right of the strip.
 *
 * SSR-safe: `useIsCompact()` is `false` on the server + first paint, so the desktop dropdown renders on
 * the very first paint (no flash, no hydration mismatch); on a phone the one post-hydration swap hides it.
 */
export function AccountMenuClient({ initials, viewerName, items, clerkSignOut }: AccountMenuClientProps) {
  const compact = useIsCompact();
  // On a phone the bottom bar owns the account entry — render nothing here to avoid a duplicate.
  if (compact) return null;

  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 50 }}>
      <KindredAccountMenu
        initials={initials}
        displayName={viewerName ?? undefined}
        items={items}
        clerkSignOut={clerkSignOut}
      />
    </div>
  );
}
