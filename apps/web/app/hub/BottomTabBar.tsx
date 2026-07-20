"use client";

import type { ComponentType } from "react";
import { BookOpen, Images, Users, MessageCircleQuestion } from "lucide-react";
import { hub } from "@/app/_copy";
import type { HubTab } from "./HubTabs";
import styles from "./BottomTabBar.module.css";
import { BOTTOM_BAR_ICON_SIZE } from "./bottom-tab-bar-constants";

/**
 * ADR-0025 mobile Phase B, Increment 1 — the fixed bottom primary-nav bar.
 *
 * The mobile counterpart to {@link HubTabs}: it renders the SAME four primary tabs with the SAME
 * numeric badges and the SAME `onChange(key)` contract (so the routing wrapper is shared behaviour),
 * but as a fixed bottom icon+label bar instead of a top pill row. It is mounted ONLY on the compact
 * branch (see {@link HubPrimaryNav}); desktop keeps the top tabs untouched.
 *
 * Presentational: navigation is delegated to `onChange` (the wrapper maps it to `router.push`), exactly
 * as HubTabs does — the two navs are one behaviour, two skins.
 */

// lucide glyph per primary tab key (ADR-0025). Icons stroke with `currentColor` so they inherit the
// active/inactive ink and theme with the rest of the bar.
const TAB_ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>> = {
  stories: BookOpen,
  album: Images,
  family: Users,
  questions: MessageCircleQuestion,
};

export interface BottomTabBarProps {
  /** The four primary tabs (Stories · Album · Family · Questions) — same array HubTabs receives. */
  primaryTabs: HubTab[];
  /** The visually-active PRIMARY key (ask/asks fold onto "questions", requests onto "family"). */
  active: string;
  onChange: (key: string) => void;
}

export function BottomTabBar({ primaryTabs, active, onChange }: BottomTabBarProps) {
  return (
    <nav className={styles.bar} role="tablist" aria-label={hub.shell.bottomNavAria}>
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
    </nav>
  );
}
