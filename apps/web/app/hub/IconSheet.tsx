"use client";

/**
 * IconSheet — labeled lucide-icon trigger for collapsed hub browse panels (Family / Search / Filters /
 * Views). ADR-0025 Phase B Increment 3 introduced the compact strip; Amendment 2026-07-21 / #300
 * migrates the open shell: bottom {@link BottomSheet} on compact viewports, anchored
 * {@link AnchoredPopover} on wide. Panel body (`children`) is shared — one composition, two chrome
 * shells. Shell selection goes through {@link resolveCollapsedBrowseShell} (not CSS).
 *
 * Presentational + self-contained open/close: tap the trigger → the panel opens with `children`.
 * Icon strokes `currentColor`. A small accent badge renders when `badgeCount > 0`. Sub tabs menus
 * are out of scope (they open a menu, not this panel).
 */
import { useRef, useState, type ComponentType, type ReactNode } from "react";
import { hub } from "@/app/_copy";
import { AnchoredPopover } from "@/app/_kindred/AnchoredPopover";
import { BottomSheet } from "@/app/_kindred/BottomSheet";
import { useIsCompact } from "@/app/_kindred/useIsCompact";
import { resolveCollapsedBrowseShell } from "./collapsed-browse-shell";
import s from "./IconSheet.module.css";
import { ICON_SHEET_GLYPH_SIZE } from "./icon-sheet-constants";

export interface IconSheetProps {
  /** A lucide icon component (rendered stroking `currentColor`). */
  icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
  /** The tiny text label beside/under the glyph (icons are labeled per ADR-0025). */
  label: string;
  /** Panel title (sheet header or popover header). */
  sheetTitle: string;
  /** Active-filter / refinement count — renders a small accent badge when > 0. */
  badgeCount?: number;
  /** The controls to group inside the panel body (shared across sheet and popover). */
  children: ReactNode;
}

export function IconSheet({ icon: Icon, label, sheetTitle, badgeCount = 0, children }: IconSheetProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const shell = resolveCollapsedBrowseShell(useIsCompact());
  const showBadge = badgeCount > 0;
  // The button's accessible name is ALWAYS label-first, with the active-count appended when badged
  // ("Filter" → "Filter, 1 filter active"). Set explicitly so the visible badge (aria-hidden below)
  // doesn't reorder the computed name, and so a `getByRole("button", { name: /Filter/ })` still matches
  // whether or not it's badged (the BottomTabBar badge convention).
  const triggerLabel = showBadge
    ? `${label}, ${hub.mobileControls.activeCountAria(badgeCount)}`
    : label;

  const body = <div className={s.body}>{children}</div>;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={s.trigger}
        onClick={() => setOpen((was) => !was)}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
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

      {shell === "sheet" ? (
        <BottomSheet open={open} onClose={() => setOpen(false)} title={sheetTitle}>
          {body}
        </BottomSheet>
      ) : (
        <AnchoredPopover
          open={open}
          onClose={() => setOpen(false)}
          title={sheetTitle}
          anchorRef={triggerRef}
        >
          {body}
        </AnchoredPopover>
      )}
    </>
  );
}
