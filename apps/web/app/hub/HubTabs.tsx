"use client";

import { useEffect, useRef, useState } from "react";
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
  /** Conditional entries (Invite / Requests) tucked behind the "More ▾" overflow menu. */
  overflowTabs: HubTab[];
  /** The visually-active PRIMARY key (ask/asks fold onto "questions" upstream in page.tsx). */
  active: string;
  onChange: (key: string) => void;
}

/**
 * Task 3 (Playful de-clutter): the primary hub nav renders exactly the four primary tabs, a
 * prominent "＋ Tell a story" CTA (a link to /hub/tell), and — when there are any — an overflow
 * "More ▾" menu for the conditional Invite/Requests entries. This regroups PRESENTATION only: the
 * routing keys are unchanged, and every entry still calls onChange(key) → the same ?tab= route as
 * before. The three ask surfaces (questions/ask/asks) collapse to the single Questions tab here; a
 * secondary sub-nav (QuestionsSubNav) switches among them inside the tab content.
 */
export function HubTabs({ primaryTabs, overflowTabs, active, onChange }: HubTabsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  // Dismiss the overflow menu on an outside click or Escape (a lightweight popover, no library).
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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

      <span className={styles.spacer} aria-hidden="true" />

      <a className={styles.cta} href="/hub/tell" aria-label={hub.shell.tellCtaAria}>
        {hub.shell.tellCta}
      </a>

      {overflowTabs.length > 0 && (
        <div className={styles.more} ref={moreRef}>
          <button
            type="button"
            className={styles.moreToggle}
            aria-label={hub.shell.moreAria}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {hub.shell.moreLabel} ▾
          </button>
          {menuOpen && (
            <div className={styles.moreMenu} role="menu">
              {overflowTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="menuitem"
                  className={styles.moreItem}
                  onClick={() => {
                    setMenuOpen(false);
                    onChange(tab.key);
                  }}
                >
                  {tab.label}
                  {tab.badge != null && tab.badge > 0 && (
                    <span className={styles.badge} aria-label={hub.shell.unreadAria(tab.badge)}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
