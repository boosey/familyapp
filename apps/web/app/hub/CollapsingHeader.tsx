"use client";

import type { ReactNode } from "react";
import { useIsCompact } from "@/app/_kindred/useIsCompact";
import { useScrollDirection } from "./useScrollDirection";
import styles from "./page.module.css";

interface CollapsingHeaderProps {
  /** The already-computed family-name display string (`·`-joined for multi-family viewers). */
  familyName: string;
  /** The rest of the header — the primary-nav row (HubPrimaryNav). On a phone HubPrimaryNav renders
   *  the fixed bottom bar (nothing in this flow), so the sliding header is visually just the name. */
  children: ReactNode;
}

/**
 * ADR-0025 mobile Phase B, Increment 2 — the hub header, made collapse-on-scroll on a phone.
 *
 * It OWNS the `<header>` element so it can make the whole header `position: sticky` on mobile. That is
 * the load-bearing structural choice: a sticky child is constrained by its containing block, and the
 * `<header>` is a direct child of the tall `.container`, so a sticky `<header>` stays pinned across the
 * full page scroll (a sticky band nested INSIDE the short header would un-stick almost immediately).
 *
 * Desktop (`useIsCompact() === false`, incl. the server + first-paint snapshot): the header renders
 * exactly as before — same `styles.header`, same title row, same children — no sticky, no transform,
 * so desktop is byte-for-byte unchanged and there is no hydration mismatch.
 *
 * Phone: the header gains `styles.headerSticky` (`sticky; top: 0`) and slides up
 * (`translateY(-100%)`) when the viewer scrolls DOWN into content, revealing again on scroll-UP —
 * reclaiming the header height while reading. The slide is CSS-only (a toggled class), suppressed under
 * `prefers-reduced-motion`. Scope is ONLY the family name + the (bottom-bar) nav.
 *
 * Increment 3 note: the sticky control strip lands as the FIRST child of `.tabContent` (a sibling of
 * this header). Once this header slides away, the strip sticks at `top: 0` — they stack cleanly because
 * this header is in-flow sticky.
 */
export function CollapsingHeader({ familyName, children }: CollapsingHeaderProps) {
  const compact = useIsCompact();
  // The listener only runs on the compact branch; on desktop this is a constant `false`.
  const hidden = useScrollDirection(compact);

  const className = compact
    ? `${styles.header} ${styles.headerSticky} ${hidden ? styles.headerHidden : ""}`
    : styles.header;

  return (
    <header className={className}>
      {/* Title row */}
      <div className={styles.titleRow}>
        <div className={styles.titleGroup}>
          <div>
            <h1 className={styles.familyName}>{familyName}</h1>
          </div>
        </div>
      </div>
      {children}
    </header>
  );
}
