"use client";

import { useState, type CSSProperties } from "react";
import { CircleUserRound } from "lucide-react";
import { hub } from "@/app/_copy";
import { BottomSheet } from "@/app/_kindred/BottomSheet";
import { AccountMenuList } from "@/app/_kindred/AccountMenuList";
import type { AccountMenuItem } from "@/app/_kindred/KindredAccountMenu";
import styles from "./BottomTabBar.module.css";
import { BOTTOM_BAR_ICON_SIZE } from "./bottom-tab-bar-constants";

export interface AccountSheetProps {
  items: AccountMenuItem[];
  clerkSignOut: boolean;
}

/**
 * ADR-0025 device round (#233) — the bottom nav bar's 5th item: the account entry. It is NOT a hub tab
 * (it doesn't switch `?tab=`) — it is a menu trigger, so it lives OUTSIDE the bar's `role="tablist"` as
 * a sibling. Tapping it opens a {@link BottomSheet} (the mobile idiom, consistent with the IconSheet
 * control strip) holding the SAME profile/settings/switch-user/log-out entries as the desktop avatar
 * dropdown — the item list is the shared {@link AccountMenuList}, so the two can't drift.
 *
 * The trigger reuses the bar's `.tab` cell styling so it sits flush with the four tabs (icon + tiny
 * label), but carries `aria-haspopup="menu"` / `aria-expanded` instead of tab semantics.
 */
export function AccountSheet({ items, clerkSignOut }: AccountSheetProps) {
  const [open, setOpen] = useState(false);

  // Match KindredAccountMenu's item rows so the sheet reads identically to the desktop dropdown.
  const itemStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "12px 12px",
    borderRadius: "var(--radius-md)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 500,
    color: "var(--text-body)",
    textDecoration: "none",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  };

  return (
    <>
      <button
        type="button"
        className={styles.tab}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className={styles.iconWrap}>
          <CircleUserRound size={BOTTOM_BAR_ICON_SIZE} strokeWidth={2} aria-hidden />
        </span>
        <span className={styles.label}>{hub.shell.tabAccount}</span>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={hub.shell.accountSheetTitle}>
        <div role="menu" aria-label={hub.shell.accountSheetTitle} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <AccountMenuList
            items={items}
            itemStyle={itemStyle}
            clerkSignOut={clerkSignOut}
            onClose={() => setOpen(false)}
          />
        </div>
      </BottomSheet>
    </>
  );
}
