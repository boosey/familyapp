"use client";

/**
 * SegmentedControl (#1/#5) — the ONE boxed pill selector for the hub. Sub-tab navs AND the radiogroup
 * view/mode selectors route through it so their pill look is single-sourced (ends the `.subLink` vs
 * `.modePill` vs AlbumViewControls-inline drift). See SegmentedControl.module.css.
 *
 * LINK mode (every item has `href`): a labelled <nav> of <a>, active = aria-current="page".
 * BUTTON mode (no href): <button>s calling onSelect(key). `variant` sets the a11y semantics:
 *   - "tabs"   → role=tablist / tab + aria-selected
 *   - "radio"  → role=radiogroup / radio + aria-checked, roving tabindex + arrow-key movement
 *   - "toggle" → role=group + aria-pressed
 * The selected VISUAL is identical across all of these (the CSS keys off any selection attribute).
 */
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import s from "./SegmentedControl.module.css";
// The count-pill is ONE shared class (centralization convention) — reuse it rather than re-declaring.
import badgeStyles from "@/app/hub/HubTabs.module.css";

export interface SegmentItem {
  key: string;
  label: ReactNode;
  /** Optional numeric badge; hidden when absent or 0. */
  badge?: number;
  /** Accessible label for the badge (the caller owns what the count MEANS). */
  badgeLabel?: string;
  /** When set on EVERY item, the control renders as a <nav> of links (active = aria-current). */
  href?: string;
}

export type SegmentedVariant = "tabs" | "radio" | "toggle";

export interface SegmentedControlProps {
  items: SegmentItem[];
  /** The active item key. */
  active: string;
  /** Accessible group name. */
  ariaLabel: string;
  /** BUTTON-mode change handler (ignored by link items). */
  onSelect?: (key: string) => void;
  /** BUTTON-mode a11y semantics (ignored by link items). Default "tabs". */
  variant?: SegmentedVariant;
}

function Badge({ item }: { item: SegmentItem }) {
  if (item.badge == null || item.badge <= 0) return null;
  return (
    <span className={badgeStyles.badge} aria-label={item.badgeLabel ?? String(item.badge)}>
      {item.badge}
    </span>
  );
}

export function SegmentedControl({ items, active, ariaLabel, onSelect, variant = "tabs" }: SegmentedControlProps) {
  const isLinks = items.length > 0 && items.every((i) => i.href != null);

  if (isLinks) {
    return (
      <nav className={s.group} aria-label={ariaLabel}>
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href!}
            className={s.pill}
            aria-current={item.key === active ? "page" : undefined}
          >
            {item.label}
            <Badge item={item} />
          </Link>
        ))}
      </nav>
    );
  }

  return <ButtonSegments items={items} active={active} ariaLabel={ariaLabel} onSelect={onSelect} variant={variant} />;
}

function ButtonSegments({
  items,
  active,
  ariaLabel,
  onSelect,
  variant,
}: {
  items: SegmentItem[];
  active: string;
  ariaLabel: string;
  onSelect?: (key: string) => void;
  variant: SegmentedVariant;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const containerRole = variant === "tabs" ? "tablist" : variant === "radio" ? "radiogroup" : "group";
  const itemRole = variant === "tabs" ? "tab" : variant === "radio" ? "radio" : undefined;

  function ariaSelection(isActive: boolean): Record<string, boolean> {
    if (variant === "tabs") return { "aria-selected": isActive };
    if (variant === "radio") return { "aria-checked": isActive };
    return { "aria-pressed": isActive };
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (variant !== "radio") return;
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else return;
    e.preventDefault();
    const target = items[next];
    if (target) {
      onSelect?.(target.key);
      refs.current[next]?.focus();
    }
  }

  return (
    <div className={s.group} role={containerRole} aria-label={ariaLabel}>
      {items.map((item, i) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role={itemRole}
            // Roving tabindex: in a radiogroup only the checked option is a tab stop (arrow keys move
            // within). tabs/toggle keep the default (every control tabbable).
            tabIndex={variant === "radio" ? (isActive ? 0 : -1) : undefined}
            className={s.pill}
            onClick={() => onSelect?.(item.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            {...ariaSelection(isActive)}
          >
            {item.label}
            <Badge item={item} />
          </button>
        );
      })}
    </div>
  );
}
