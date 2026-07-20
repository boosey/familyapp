"use client";

/**
 * useScrollDirection (ADR-0025 Phase B, Increment 2) — returns whether the collapse-on-scroll header
 * should currently be HIDDEN. Reads `window.scrollY` on a **passive**, **rAF-throttled** scroll
 * listener (so it never blocks or fights momentum scrolling) and runs each sample through the pure
 * {@link nextHeaderState} reducer.
 *
 * SSR-safe: returns `false` (shown) on the server and first paint — there is no scroll offset yet, and
 * this matches the header's resting state so there is no hydration flash. The listener is only attached
 * on the client, and only while `enabled` (the header passes `useIsCompact()` so the listener never
 * runs on desktop).
 */
import { useEffect, useRef, useState } from "react";
import {
  INITIAL_HEADER_STATE,
  nextHeaderState,
  type HeaderScrollState,
} from "./scroll-direction";

/** @param enabled attach the listener only when true (mobile). When false the header is always shown. */
export function useScrollDirection(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  // The reducer state lives in a ref so the rAF callback reads/writes the latest without re-subscribing.
  const stateRef = useRef<HeaderScrollState>(INITIAL_HEADER_STATE);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      // Reset to shown whenever we leave the enabled branch (e.g. rotate to a desktop width).
      stateRef.current = INITIAL_HEADER_STATE;
      setHidden(false);
      return;
    }

    let frame = 0;
    const sample = () => {
      frame = 0;
      const next = nextHeaderState(stateRef.current, window.scrollY);
      if (next !== stateRef.current) {
        stateRef.current = next;
        setHidden(next.hidden);
      }
    };
    // Coalesce bursts of scroll events into one read per animation frame.
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(sample);
    };

    // Seed from the current position (e.g. a restored scroll on back-nav) before the first event.
    sample();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return hidden;
}
