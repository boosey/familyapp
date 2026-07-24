"use client";

/**
 * Account › Appearance — the DEVICE-LOCAL app preference controls (ADR-0020), relocated from
 * /hub/settings' SettingsPanel. Every control here reads/writes localStorage and applies to this
 * browser only, so this stays a client component. Section heading/intro copy comes from `./copy.ts`.
 */
import type { CSSProperties } from "react";
import { KindredFontScale } from "@/app/_kindred/KindredFontScale";
import { KindredSkinPicker } from "@/app/_kindred/KindredSkinPicker";
import { KindredMotionToggle } from "@/app/_kindred/KindredMotionToggle";
import { KindredRecordingGesturePicker } from "@/app/_kindred/KindredRecordingGesturePicker";
import { appearanceCopy } from "./copy";

export function AppearanceControls() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <section aria-labelledby="appearance-skin">
        <h2 id="appearance-skin" style={sectionTitle}>
          {appearanceCopy.skinHeading}
        </h2>
        <KindredSkinPicker />
      </section>

      <section aria-labelledby="appearance-motion">
        <h2 id="appearance-motion" style={sectionTitle}>
          {appearanceCopy.motionHeading}
        </h2>
        <KindredMotionToggle />
      </section>

      <section aria-labelledby="appearance-recording-gesture">
        <h2 id="appearance-recording-gesture" style={sectionTitle}>
          {appearanceCopy.recordingGestureHeading}
        </h2>
        <KindredRecordingGesturePicker />
      </section>

      <section aria-labelledby="appearance-text-size">
        <h2 id="appearance-text-size" style={sectionTitle}>
          {appearanceCopy.textSizeHeading}
        </h2>
        <KindredFontScale />
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

