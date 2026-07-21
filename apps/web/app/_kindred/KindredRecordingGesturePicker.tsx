"use client";
import { useEffect, useState, type CSSProperties } from "react";
import {
  RECORDING_GESTURE_VALUES,
  type RecordingGestureValue,
} from "./recording-gesture-constants";
import { hub } from "@/app/_copy";
import { PREFERENCES } from "./preferences/registry";
import { readPreference, setPreference } from "./preferences/client";

const phonePref = PREFERENCES.recordingGesturePhone;
const desktopPref = PREFERENCES.recordingGestureDesktop;

function gestureLabel(v: RecordingGestureValue): string {
  return v === "hold" ? hub.settings.recordingGestureHoldLabel : hub.settings.recordingGestureTapLabel;
}

function SegmentedGroup({
  ariaLabel,
  value,
  onChoose,
}: {
  ariaLabel: string;
  value: RecordingGestureValue;
  onChoose: (v: RecordingGestureValue) => void;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: "flex", gap: 12 }}>
      {RECORDING_GESTURE_VALUES.map((v) => {
        const on = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChoose(v)}
            aria-pressed={on}
            aria-label={`${gestureLabel(v)} — ${ariaLabel}`}
            style={cell(on)}
          >
            {gestureLabel(v)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Settings control: separate phone + desktop recording-gesture pickers (tap vs hold).
 * Device-local via the preference registry; no DOM apply (js-read).
 */
export function KindredRecordingGesturePicker() {
  const [phone, setPhone] = useState<RecordingGestureValue>(phonePref.default as RecordingGestureValue);
  const [desktop, setDesktop] = useState<RecordingGestureValue>(
    desktopPref.default as RecordingGestureValue,
  );
  useEffect(() => {
    setPhone(readPreference(phonePref) as RecordingGestureValue);
    setDesktop(readPreference(desktopPref) as RecordingGestureValue);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <p style={groupLabel}>{hub.settings.recordingGesturePhoneHeading}</p>
        <SegmentedGroup
          ariaLabel={hub.settings.recordingGesturePhoneAria}
          value={phone}
          onChoose={(v) => {
            setPhone(v);
            setPreference(phonePref, v);
          }}
        />
      </div>
      <div>
        <p style={groupLabel}>{hub.settings.recordingGestureDesktopHeading}</p>
        <SegmentedGroup
          ariaLabel={hub.settings.recordingGestureDesktopAria}
          value={desktop}
          onChoose={(v) => {
            setDesktop(v);
            setPreference(desktopPref, v);
          }}
        />
      </div>
    </div>
  );
}

const groupLabel: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  fontWeight: 600,
  color: "var(--text-body)",
  margin: "0 0 10px",
};

function cell(on: boolean): CSSProperties {
  return {
    padding: "12px 20px",
    minHeight: "var(--touch-min)",
    cursor: "pointer",
    borderRadius: "var(--radius-md)",
    border: on ? "2px solid var(--accent)" : "var(--border-width) solid var(--border-strong)",
    background: on ? "var(--accent-soft)" : "var(--surface-card)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    fontWeight: 600,
    color: "var(--text-body)",
  };
}
