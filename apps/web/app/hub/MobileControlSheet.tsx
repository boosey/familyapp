"use client";

/**
 * MobileControlSheet (ADR-0024 mobile pass) — the trigger+sheet wrapper the hub tabs use on a phone to
 * hide their secondary controls (search, family chips, view/layout toggles, album date/facet filters +
 * size slider) behind ONE "⚙ Filters & view" button. Tapping it opens the shared {@link BottomSheet}
 * holding `children`; a small accent count badge shows how many secondary filters are active so the
 * viewer knows something is narrowing the view even while it's tucked away.
 *
 * This component is ONLY ever rendered on the mobile branch — each tab decides via `useIsCompact` and
 * renders its existing inline HubToolbar on desktop — so it carries no viewport logic of its own.
 */
import { useState, type ReactNode } from "react";
import { hub } from "@/app/_copy";
import { BottomSheet } from "@/app/_kindred/BottomSheet";
import s from "./MobileControlSheet.module.css";

export interface MobileControlSheetProps {
  /** The trigger + sheet title. Defaults to the shared "Filters & view" copy. */
  label?: string;
  /** How many secondary filters/controls are non-default — drives the accent count badge (>0 shows it). */
  activeCount?: number;
  /** The secondary controls to group inside the sheet. */
  children: ReactNode;
}

export function MobileControlSheet({
  label = hub.mobileControls.label,
  activeCount = 0,
  children,
}: MobileControlSheetProps) {
  const [open, setOpen] = useState(false);
  const showBadge = activeCount > 0;

  return (
    <>
      <button type="button" className={s.trigger} onClick={() => setOpen(true)}>
        <span className={s.gear} aria-hidden="true">
          ⚙
        </span>
        {label}
        {showBadge ? (
          <span className={s.badge} aria-label={hub.mobileControls.activeCountAria(activeCount)}>
            {activeCount}
          </span>
        ) : null}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className={s.body}>{children}</div>
      </BottomSheet>
    </>
  );
}
