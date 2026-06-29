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

export function HubTabs({ tabs, active, onChange }: HubTabsProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const navStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontFamily: "var(--font-ui)",
  };

  function getTabStyle(key: string): CSSProperties {
    const isActive = key === active;
    const isHovered = key === hovered;

    return {
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "8px 16px",
      borderRadius: "var(--radius-md)",
      border: "none",
      background: isActive ? "var(--accent-soft)" : isHovered ? "var(--surface-sunken)" : "transparent",
      color: isActive ? "var(--accent)" : "var(--text-meta)",
      fontFamily: "var(--font-ui)",
      fontSize: "var(--text-ui-sm)",
      fontWeight: isActive ? 600 : 500,
      cursor: "pointer",
      transition: "background var(--dur-fade) var(--ease-quiet), color var(--dur-fade) var(--ease-quiet)",
      outline: "none",
      minHeight: "var(--touch-min)",
    };
  }

  const badgeStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 18,
    height: 18,
    padding: "0 5px",
    borderRadius: "var(--radius-pill)",
    background: "var(--accent)",
    color: "var(--accent-on)",
    fontFamily: "var(--font-ui)",
    fontSize: "0.75rem",
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
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 0 4px var(--accent-soft)";
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
