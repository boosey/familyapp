"use client";

import { hub } from "@/app/_copy";
import styles from "./HubTabs.module.css";

export interface HubTab {
  key: string;
  label: string;
  badge?: number;
}

export interface HubTabsProps {
  /** The four primary tabs (Stories · Album · Family · Questions). */
  primaryTabs: HubTab[];
  /** The visually-active PRIMARY key (ask/asks fold onto "questions", requests onto "family",
   *  upstream in page.tsx). */
  active: string;
  onChange: (key: string) => void;
}

/**
 * Issue #124 (Playful de-clutter): the primary hub nav renders exactly the four primary tabs, each
 * with an optional numeric badge (the Family tab badges the steward's pending join-request count; the
 * Questions tab badges pending asks). There is no longer a global "＋ Tell a story" CTA (a single
 * Tell-a-story affordance lives on the Stories tab, #125) and no "More ▾" overflow menu — the two
 * conditional entries moved OUT of the chrome (Invite is a button on the Family surface; Requests is a
 * secondary sub-nav under the Family tab, see FamilySubNav). This regroups PRESENTATION only: the
 * routing keys are unchanged, and every tab still calls onChange(key) → the same ?tab= route as before.
 */
export function HubTabs({ primaryTabs, active, onChange }: HubTabsProps) {
  return (
    <nav className={styles.nav} role="tablist" aria-label={hub.shell.sectionsAria}>
      {primaryTabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === active}
          className={styles.tab}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.badge != null && tab.badge > 0 && (
            <span className={styles.badge} aria-label={hub.shell.unreadAria(tab.badge)}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
