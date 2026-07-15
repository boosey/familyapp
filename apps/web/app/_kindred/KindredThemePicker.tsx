"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { THEME_IDS, type ThemeId } from "./theme-constants";
import { hub } from "@/app/_copy";
import { PREFERENCES } from "./preferences/registry";
import { readPreference, setPreference, applyPreference } from "./preferences/client";

const pref = PREFERENCES.theme;

const SWATCH: Record<ThemeId, { page: string; accent: string }> = {
  heirloom: { page: "#F4ECE0", accent: "#BD5B3D" },
  archive: { page: "#ECEEF0", accent: "#45707C" },
  hearth: { page: "#F3E4DD", accent: "#B5524C" },
};

export function KindredThemePicker() {
  const [active, setActive] = useState<ThemeId>(pref.default);

  useEffect(() => {
    const theme = readPreference(pref) as ThemeId;
    setActive(theme);
    applyPreference(pref, theme);
  }, []);

  function choose(theme: ThemeId): void {
    setActive(theme);
    setPreference(pref, theme);
  }

  return (
    <div role="group" aria-label={hub.settings.paletteAria} style={groupStyle}>
      {THEME_IDS.map((id) => {
        const on = id === active;
        const sw = SWATCH[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => choose(id)}
            aria-pressed={on}
            aria-label={hub.settings.paletteLabels[id]}
            title={hub.settings.paletteLabels[id]}
            style={cellStyle(on)}
          >
            <span style={swatchStyle(sw.page, sw.accent)} aria-hidden="true" />
            <span style={labelStyle}>{hub.settings.paletteShort[id]}</span>
          </button>
        );
      })}
    </div>
  );
}

const groupStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
};

function cellStyle(on: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    minWidth: 100,
    cursor: "pointer",
    borderRadius: "var(--radius-md)",
    border: on
      ? "2px solid var(--accent)"
      : "var(--border-width) solid var(--border-strong)",
    background: on ? "var(--accent-soft)" : "var(--surface-card)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 600,
    color: "var(--text-body)",
  };
}

function swatchStyle(page: string, accent: string): CSSProperties {
  return {
    width: 48,
    height: 32,
    borderRadius: 6,
    background: page,
    border: "1px solid var(--border)",
    boxShadow: `inset 0 -6px 0 ${accent}`,
  };
}

const labelStyle: CSSProperties = {
  lineHeight: 1.2,
};
