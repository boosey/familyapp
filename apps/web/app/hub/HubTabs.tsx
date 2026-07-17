"use client";

import { useState, type CSSProperties } from "react";
import { hub } from "@/app/_copy";

export interface HubTab {
  key: string;
  label: string;
  badge?: number;
}

export interface HubTabsProps {
  tabs: HubTab[];
  active: string;
  onChange: (key: string) => void;
}

/** Editorial tab strip — text + underline, no glass rail / gradient pill. */
export function HubTabs({ tabs, active, onChange }: HubTabsProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const navStyle: CSSProperties = {
    display: "flex",
    alignItems: "stretch",
    gap: 0,
    fontFamily: "var(--font-ui)",
    overflowX: "auto",
    scrollbarWidth: "thin",
    WebkitOverflowScrolling: "touch",
    borderBottom: "var(--border-width) solid var(--border)",
  };

  function getTabStyle(key: string): CSSProperties {
    const isActive = key === active;
    const isHovered = key === hovered;

    return {
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "14px 16px",
      borderRadius: 0,
      border: "none",
      borderBottom: isActive
        ? "3px solid var(--accent)"
        : "3px solid transparent",
      marginBottom: -2,
      background: "transparent",
      color: isActive ? "var(--text-body)" : isHovered ? "var(--text-body)" : "var(--text-meta)",
      fontFamily: "var(--font-ui)",
      fontSize: "var(--text-ui-sm)",
      fontWeight: isActive ? 600 : 500,
      cursor: "pointer",
      transition: "color var(--dur-fade) var(--ease-quiet), border-color var(--dur-fade) var(--ease-quiet)",
      outline: "none",
      minHeight: "var(--touch-min)",
      whiteSpace: "nowrap",
      flex: "0 0 auto",
    };
  }

  const badgeStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 20,
    height: 20,
    padding: "0 6px",
    borderRadius: "var(--radius-sm)",
    background: "var(--accent)",
    color: "var(--accent-on)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.7rem",
    fontWeight: 700,
    lineHeight: 1,
  };

  return (
    <nav style={navStyle} role="tablist" aria-label={hub.shell.sectionsAria}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === active}
          style={getTabStyle(tab.key)}
          onClick={() => onChange(tab.key)}
          onMouseEnter={() => setHovered(tab.key)}
          onMouseLeave={() => setHovered(null)}
          onFocus={(e) => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 0 0 3px var(--accent-soft)";
          }}
          onBlur={(e) => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
          }}
        >
          {tab.label}
          {tab.badge != null && tab.badge > 0 && (
            <span style={badgeStyle} aria-label={hub.shell.unreadAria(tab.badge)}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
