"use client";

/**
 * useIsCompact (ADR-0024) — the ONE viewport hook the hub tabs branch on to swap their inline
 * desktop toolbar for the mobile "Filters & view" bottom-sheet layout. It answers a single question:
 * "is this a phone (< 40rem / 640px)?".
 *
 * SSR-safe by design. The server snapshot AND the client's first-paint snapshot BOTH return `false`
 * (the desktop / inline layout), so:
 *  - server-rendered markup and the first client render agree → NO hydration mismatch, and
 *  - desktop never regresses (it renders the existing inline HubToolbar on the very first paint).
 * On a phone the subscription fires once after hydration and corrects the value to `true`, which is a
 * one-time layout swap (the tab re-renders into its mobile branch). This is the accepted trade named in
 * the task: a single post-hydration swap on phones, never a desktop flash.
 *
 * The 39.999rem ceiling is `< 40rem` expressed as a `max-width` (matchMedia has no strict `<`); 40rem is
 * the canonical `sm` breakpoint (RESPONSIVE_BREAKPOINTS_REM.sm). This is the ONE allowed max-width in
 * the app — it lives in JS (a matchMedia string), not in a CSS `@media` layer, so the mobile-first
 * `min-width`-only CSS guard (responsive-breakpoints.test.ts) is unaffected.
 */
import { useSyncExternalStore } from "react";
import { RESPONSIVE_BREAKPOINTS_REM } from "@/lib/constants";

// `< sm` as a matchMedia ceiling. 0.001rem below the breakpoint so exactly 40rem is desktop (matching
// the CSS `@media (min-width: 40rem)` layers, which include 40rem in the desktop range).
const COMPACT_QUERY = `(max-width: ${RESPONSIVE_BREAKPOINTS_REM.sm - 0.001}rem)`;

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mql = window.matchMedia(COMPACT_QUERY);
  // addEventListener("change", …) is the modern API; every browser we target supports it.
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(COMPACT_QUERY).matches;
}

// Server snapshot + first client paint: always desktop/inline (false) so SSR and hydration agree.
function getServerSnapshot(): boolean {
  return false;
}

/** True on a phone-width viewport (< 40rem). SSR-safe: `false` on the server + first paint. */
export function useIsCompact(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
