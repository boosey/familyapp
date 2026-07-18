"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { REDUCE_MOTION_VALUES, type ReduceMotionValue } from "./motion-constants";
import { hub } from "@/app/_copy";
import { PREFERENCES } from "./preferences/registry";
import { readPreference, setPreference, applyPreference } from "./preferences/client";

const pref = PREFERENCES.reduceMotion;
export function KindredMotionToggle() {
  const [value, setValue] = useState<ReduceMotionValue>(pref.default as ReduceMotionValue);
  useEffect(() => {
    const v = readPreference(pref) as ReduceMotionValue; setValue(v); applyPreference(pref, v);
  }, []);
  function choose(v: ReduceMotionValue): void { setValue(v); setPreference(pref, v); }
  const label = (v: ReduceMotionValue) => (v === "on" ? hub.settings.motionOnLabel : hub.settings.motionOffLabel);
  return (
    <div role="group" aria-label={hub.settings.motionAria} style={{ display: "flex", gap: 12 }}>
      {REDUCE_MOTION_VALUES.map((v) => {
        const on = v === value;
        return (
          <button key={v} type="button" onClick={() => choose(v)} aria-pressed={on}
            aria-label={`${label(v)} — ${hub.settings.motionAria}`} style={cell(on)}>
            {label(v)}
          </button>
        );
      })}
    </div>
  );
}
function cell(on: boolean): CSSProperties { return {
  padding:"12px 20px", minHeight:"var(--touch-min)", cursor:"pointer", borderRadius:"var(--radius-md)",
  border: on ? "2px solid var(--accent)" : "var(--border-width) solid var(--border-strong)",
  background: on ? "var(--accent-soft)" : "var(--surface-card)",
  fontFamily:"var(--font-ui)", fontSize:"var(--text-ui-sm)", fontWeight:600, color:"var(--text-body)" };
}
