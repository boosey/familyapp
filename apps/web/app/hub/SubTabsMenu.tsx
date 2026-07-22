"use client";

/**
 * SubTabsMenu (#301/#297) — menu-icon stage for progressive Sub tabs. Opens a lightweight menu of
 * browse modes (Feed / Timeline / Tree / …), not a sheet/popover. Mechanics mirror AddPhotosMenu /
 * OwnerActionMenu: click-outside, Escape, role="menu". When an item carries a pending count (Family
 * Requests / Questions To-answer), the trigger badges that count so it stays visible under menu-icon.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Rows3 } from "lucide-react";
import { hub } from "@/app/_copy";
import {
  HUB_SUB_TABS_GLYPH_SIZE,
} from "./hub-progressive-control-constants";
import sheet from "./IconSheet.module.css";
import hubTabStyles from "./HubTabs.module.css";
import s from "./SubTabsMenu.module.css";

export interface SubTabsMenuItem {
  key: string;
  label: string;
  /** Optional numeric badge (#297 Family Requests / Questions To-answer); hidden when absent or 0. */
  badge?: number;
  /** Accessible label for the badge (the caller owns what the count MEANS). */
  badgeLabel?: string;
}

export interface SubTabsMenuProps {
  items: SubTabsMenuItem[];
  active: string;
  onSelect: (key: string) => void;
  /** Accessible name for the menu trigger + menu. Defaults to hub.mobileControls.subTabsMenuAria. */
  ariaLabel?: string;
  /** Optional trigger glyph override (tests / Album-free reuse). */
  icon?: ReactNode;
}

export function SubTabsMenu({
  items,
  active,
  onSelect,
  ariaLabel = hub.mobileControls.subTabsMenuAria,
  icon,
}: SubTabsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const badged = items.find((item) => item.badge != null && item.badge > 0);
  const triggerBadge = badged?.badge ?? 0;
  const triggerLabel =
    triggerBadge > 0 && badged?.badgeLabel
      ? `${ariaLabel}, ${badged.badgeLabel}`
      : ariaLabel;

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={s.root}>
      <button
        type="button"
        className={sheet.trigger}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <span className={sheet.iconWrap}>
          {icon ?? <Rows3 size={HUB_SUB_TABS_GLYPH_SIZE} strokeWidth={2} aria-hidden />}
          {triggerBadge > 0 ? (
            <span className={sheet.badge} aria-hidden="true">
              {triggerBadge}
            </span>
          ) : null}
        </span>
        <span className={sheet.label} aria-hidden="true">
          {hub.mobileControls.subTabsLabel}
        </span>
      </button>
      {open ? (
        <div id={menuId} className={s.menu} role="menu" aria-label={ariaLabel}>
          {items.map((item) => {
            const isActive = item.key === active;
            const badge =
              item.badge != null && item.badge > 0 ? (
                <span
                  className={hubTabStyles.badge}
                  aria-label={item.badgeLabel ?? String(item.badge)}
                >
                  {item.badge}
                </span>
              ) : null;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                className={isActive ? `${s.item} ${s.itemActive}` : s.item}
                aria-current={isActive ? "true" : undefined}
                onClick={() => {
                  setOpen(false);
                  onSelect(item.key);
                }}
              >
                {item.label}
                {badge}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
