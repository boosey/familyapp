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
    alignItems: "stretch",
    gap: 2,
    fontFamily: "var(--font-ui)",
    overflowX: "auto",
    scrollbarWidth: "thin",
    WebkitOverflowScrolling: "touch",
    paddingBottom: 2,
  };

  function getTabStyle(key: string): CSSProperties {
    const isActive = key === active;
    const isHovered = key === hovered;

    return {
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "12px 18px",
      borderRadius: "var(--radius-md)",
      border: "none",
      background: isActive
        ? "var(--surface-card)"
        : isHovered
          ? "color-mix(in srgb, var(--surface-card) 70%, transparent)"
          : "transparent",
      color: isActive ? "var(--text-body)" : "var(--text-meta)",
      fontFamily: "var(--font-ui)",
      fontSize: "var(--text-ui-sm)",
      fontWeight: isActive ? 650 : 500,
      cursor: "pointer",
      transition:
        "background var(--dur-fade) var(--ease-quiet), color var(--dur-fade) var(--ease-quiet), box-shadow var(--dur-settle) var(--ease-spring)",
      outline: "none",
      minHeight: "var(--touch-min)",
      whiteSpace: "nowrap",
      boxShadow: isActive ? "var(--shadow-sm)" : "none",
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
    background: "var(--support)",
    color: "#fff",
    fontFamily: "var(--font-mono)",
    fontSize: "0.7rem",
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: "0.02em",
  };

  const indicatorStyle: CSSProperties = {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 4,
    height: 3,
    borderRadius: 999,
    background: "linear-gradient(90deg, var(--accent), var(--support))",
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
              "0 0 0 4px var(--accent-soft)";
          }}
          onBlur={(e) => {
            const isActive = tab.key === active;
            (e.currentTarget as HTMLButtonElement).style.boxShadow = isActive
              ? "var(--shadow-sm)"
              : "none";
          }}
        >
          {tab.label}
          {tab.badge != null && tab.badge > 0 && (
            <span style={badgeStyle} aria-label={hub.shell.unreadAria(tab.badge)}>
              {tab.badge}
            </span>
          )}
          {tab.key === active ? <span aria-hidden="true" style={indicatorStyle} /> : null}
        </button>
      ))}
    </nav>
  );
}
