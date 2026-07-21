"use client";

/**
 * Resolves the recording-gesture preference for the current form factor.
 * Phone = compact viewport (`useIsCompact`); desktop = not compact.
 *
 * SSR-safe: first paint is always tap (default), then the stored preference is applied after
 * mount. Reading localStorage during render would disagree with the server HTML whenever the
 * stored value is hold — captions and hold vs tap wiring are first-paint markup on hub compose
 * and about-you. (Unlike reduceMotion in ComposingEditor, which only affects listening-only UI.)
 */
import { useEffect, useState } from "react";
import { useIsCompact } from "./useIsCompact";
import { PREFERENCES } from "./preferences/registry";
import { readPreference } from "./preferences/client";

export function useRecordingGesture(): { holdToRecord: boolean } {
  const compact = useIsCompact();
  // SSR + first client paint: tap, so hydration matches the server default.
  const [holdToRecord, setHoldToRecord] = useState(false);

  useEffect(() => {
    const pref = compact ? PREFERENCES.recordingGesturePhone : PREFERENCES.recordingGestureDesktop;
    setHoldToRecord(readPreference(pref) === "hold");
  }, [compact]);

  return { holdToRecord };
}
