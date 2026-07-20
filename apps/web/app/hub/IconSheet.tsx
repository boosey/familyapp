"use client";

/**
 * IconSheet (ADR-0025 Phase B, Increment 3) — a labeled lucide-icon trigger that opens the shared
 * {@link BottomSheet} holding its controls. It replaced the former single "⚙ Filters & view" gear with
 * a per-concern icon: a tab's strip renders up to three of these — View / Family / Filter — each opening
 * its own sheet, instead of one gear for everything.
 *
 * Presentational + self-contained open/close: tap the trigger → the sheet opens with `children`. The
 * icon strokes `currentColor` so it themes with the trigger ink. A small
 * accent badge renders when `badgeCount > 0` (the active-filter count) — Step A never passes one; the
 * slot exists for Increment 4's per-icon active badges.
 *
 * Mobile-only: mounted solely on a tab's compact branch (the tab gates on `useIsCompact`), so it carries
 * no viewport logic and no desktop media layer.
 */
import { useState, type ComponentType, type ReactNode } from "react";
import { hub } from "@/app/_copy";
import { BottomSheet } from "@/app/_kindred/BottomSheet";
import s from "./IconSheet.module.css";
import { ICON_SHEET_GLYPH_SIZE } from "./icon-sheet-constants";

export interface IconSheetProps {
  /** A lucide icon component (rendered stroking `currentColor`). */
  icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
  /** The tiny text label beside/under the glyph (icons are labeled per ADR-0025). */
  label: string;
  /** The bottom sheet's title. */
  sheetTitle: string;
  /** Active-filter count — renders a small accent badge when > 0. Unused in Step A (Increment 4 wires it). */
  badgeCount?: number;
  /** The controls to group inside the sheet. */
  children: ReactNode;
}

export function IconSheet({ icon: Icon, label, sheetTitle, badgeCount = 0, children }: IconSheetProps) {
  const [open, setOpen] = useState(false);
  const showBadge = badgeCount > 0;
  // The button's accessible name is ALWAYS label-first, with the active-count appended when badged
  // ("Filter" → "Filter, 1 filter active"). Set explicitly so the visible badge (aria-hidden below)
  // doesn't reorder the computed name, and so a `getByRole("button", { name: /Filter/ })` still matches
  // whether or not it's badged (the BottomTabBar badge convention).
  const triggerLabel = showBadge
    ? `${label}, ${hub.mobileControls.activeCountAria(badgeCount)}`
    : label;

  return (
    <>
      <button type="button" className={s.trigger} onClick={() => setOpen(true)} aria-label={triggerLabel}>
        <span className={s.iconWrap}>
          <Icon size={ICON_SHEET_GLYPH_SIZE} strokeWidth={2} aria-hidden />
          {showBadge ? (
            <span className={s.badge} aria-hidden="true">
              {badgeCount}
            </span>
          ) : null}
        </span>
        <span className={s.label} aria-hidden="true">
          {label}
        </span>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={sheetTitle}>
        <div className={s.body}>{children}</div>
      </BottomSheet>
    </>
  );
}
