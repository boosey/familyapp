"use client";
import { useEffect, useState } from "react";
import { REDUCE_MOTION_VALUES, type ReduceMotionValue } from "./motion-constants";
import { hub } from "@/app/_copy";
import { PREFERENCES } from "./preferences/registry";
import { readPreference, setPreference, applyPreference } from "./preferences/client";
import { SegmentedControl } from "./SegmentedControl";

const pref = PREFERENCES.reduceMotion;
export function KindredMotionToggle() {
  const [value, setValue] = useState<ReduceMotionValue>(pref.default as ReduceMotionValue);
  useEffect(() => {
    const v = readPreference(pref) as ReduceMotionValue; setValue(v); applyPreference(pref, v);
  }, []);
  function choose(v: ReduceMotionValue): void { setValue(v); setPreference(pref, v); }
  const label = (v: ReduceMotionValue) => (v === "on" ? hub.settings.motionOnLabel : hub.settings.motionOffLabel);
  return (
    <SegmentedControl
      variant="toggle"
      items={REDUCE_MOTION_VALUES.map((v) => ({ key: v, label: label(v) }))}
      active={value}
      onSelect={(k) => choose(k as ReduceMotionValue)}
      ariaLabel={hub.settings.motionAria}
    />
  );
}
