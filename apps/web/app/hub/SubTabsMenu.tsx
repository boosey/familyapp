"use client";

/**
 * SubTabsMenu (#301) — menu-icon stage for progressive Sub tabs. Opens a lightweight menu of browse
 * modes (Feed / Timeline, …), not a sheet/popover. Mechanics mirror AddPhotosMenu / OwnerActionMenu:
 * click-outside, Escape, role="menu".
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Rows3 } from "lucide-react";
import { hub } from "@/app/_copy";
import {
  HUB_SUB_TABS_GLYPH_SIZE,
} from "./hub-progressive-control-constants";
import sheet from "./IconSheet.module.css";
import s from "./SubTabsMenu.module.css";

export interface SubTabsMenuItem {
  key: string;
  label: string;
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
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <span className={sheet.iconWrap}>
          {icon ?? <Rows3 size={HUB_SUB_TABS_GLYPH_SIZE} strokeWidth={2} aria-hidden />}
        </span>
        <span className={sheet.label} aria-hidden="true">
          {hub.mobileControls.subTabsLabel}
        </span>
      </button>
      {open ? (
        <div id={menuId} className={s.menu} role="menu" aria-label={ariaLabel}>
          {items.map((item) => {
            const isActive = item.key === active;
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
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
