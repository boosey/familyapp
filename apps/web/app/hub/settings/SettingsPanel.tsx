"use client";

import { KindredFontScale } from "@/app/_kindred/KindredFontScale";
import { KindredThemePicker } from "@/app/_kindred/KindredThemePicker";
import { hub } from "@/app/_copy";
import type { CSSProperties } from "react";

export function SettingsPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <section aria-labelledby="settings-text-size">
        <h2 id="settings-text-size" style={sectionTitle}>
          {hub.settings.textSizeHeading}
        </h2>
        <p style={sectionIntro}>{hub.settings.textSizeIntro}</p>
        <KindredFontScale />
      </section>

      <section aria-labelledby="settings-palette">
        <h2 id="settings-palette" style={sectionTitle}>
          {hub.settings.paletteHeading}
        </h2>
        <p style={sectionIntro}>{hub.settings.paletteIntro}</p>
        <KindredThemePicker />
      </section>
    </div>
  );
}

const sectionTitle: CSSProperties = {
  fontFamily: "var(--font-story)",
  fontSize: "var(--text-story-lg)",
  fontWeight: 400,
  color: "var(--text-body)",
  margin: "0 0 8px",
};

const sectionIntro: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
  margin: "0 0 16px",
  lineHeight: "var(--leading-snug)",
};
