"use client";

import { hub } from "@/app/_copy";
import { TAB_ICONS } from "./HubTabs";
import type { HubTab } from "./HubTabs";
import { AccountSheet, type AccountSheetProps } from "./AccountSheet";
import styles from "./BottomTabBar.module.css";
import { BOTTOM_BAR_ICON_SIZE } from "./bottom-tab-bar-constants";

/**
 * ADR-0025 mobile Phase B — the fixed bottom primary-nav bar.
 *
 * The mobile counterpart to {@link HubTabs}: it renders the SAME four primary tabs with the SAME
 * numeric badges and the SAME `onChange(key)` contract, as a fixed bottom icon+label bar. Increment 3
 * device round (#233) adds a 5th item — the account entry — which is NOT a hub tab (it opens the account
 * menu, not a `?tab=` route), so it lives OUTSIDE the `role="tablist"` as a sibling {@link AccountSheet}.
 *
 * Presentational: tab navigation is delegated to `onChange` (the wrapper maps it to `router.push`).
 */

export interface BottomTabBarProps {
  /** The four primary tabs (Stories · Album · Family · Questions) — same array HubTabs receives. */
  primaryTabs: HubTab[];
  /** The visually-active PRIMARY key (ask/asks fold onto "questions", requests onto "family"). */
  active: string;
  onChange: (key: string) => void;
  /** The resolved account menu (#233). When present, a 5th "Account" item opens it in a bottom sheet;
   *  omit (e.g. a viewer with no account context) and only the four tabs render. */
  account?: AccountSheetProps;
}

export function BottomTabBar({ primaryTabs, active, onChange, account }: BottomTabBarProps) {
  return (
    <nav className={styles.bar} aria-label={hub.shell.bottomNavAria}>
      {/* The four primary tabs are a real flex-box tablist (NOT display:contents, so its role survives
          on VoiceOver): it takes 4/5 of the bar (flex:4) and its four tabs split it evenly; the account
          cell takes the last 1/5 (flex:1) → five equal cells. */}
      <div role="tablist" aria-label={hub.shell.bottomNavAria} className={styles.tablist}>
        {primaryTabs.map((tab) => {
          const Icon = TAB_ICONS[tab.key];
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              className={styles.tab}
              onClick={() => onChange(tab.key)}
            >
              <span className={styles.iconWrap}>
                {Icon && <Icon size={BOTTOM_BAR_ICON_SIZE} strokeWidth={2} aria-hidden />}
                {tab.badge != null && tab.badge > 0 && (
                  <span className={styles.badge} aria-label={hub.shell.unreadAria(tab.badge)}>
                    {tab.badge}
                  </span>
                )}
              </span>
              <span className={styles.label}>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 5th item — the account menu trigger, a sibling OUTSIDE the tablist (it is not a tab). Wrapped
          in a flex-1 cell that mirrors the tablist's box so all five cells size evenly (the account cell
          takes the last 1/5 the way each tab takes 1/4 of the tablist's 4/5). */}
      {account ? (
        <div className={styles.accountCell}>
          <AccountSheet items={account.items} clerkSignOut={account.clerkSignOut} />
        </div>
      ) : null}
    </nav>
  );
}
