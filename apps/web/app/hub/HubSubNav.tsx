import Link from "next/link";
import type { ReactNode } from "react";
// The pill look is single-sourced in the shared SegmentedControl module (`.group` box + `.pill`), the
// SAME classes the SegmentedControl view/mode selectors use — so sub-tabs and view controls wear ONE
// boxed pill and can't drift (#1/#5). The count-badge stays the shared `.badge` in HubTabs.module.css.
import seg from "@/app/_kindred/SegmentedControl.module.css";
import hubTabStyles from "./HubTabs.module.css";

/** One pill in a HubSubNav. A `href` renders a <Link> (<a>); otherwise it's a <button>. */
export interface HubSubNavItem {
  /** Stable key; also the value passed to `onSelect` for button items. */
  key: string;
  /** Visible pill label. */
  label: ReactNode;
  /** Link items: navigation target. Omit for button items. */
  href?: string;
  /** Optional numeric badge; hidden when absent or 0. */
  badge?: number;
  /** Accessible label for the badge (the caller owns what the count MEANS). */
  badgeLabel?: string;
  /**
   * Optional accessible name override (#301 icon-pills): when the visible label is an icon-only
   * glyph, set this so the pill still announces "Feed" / "Timeline" (etc.).
   */
  ariaLabel?: string;
}

export interface HubSubNavProps {
  /** Accessible name for the nav region. */
  ariaLabel: string;
  items: HubSubNavItem[];
  /** The active item key → `aria-current="page"`. */
  active: string;
  /** Button-mode click handler (receives the item key). Ignored by link items. */
  onSelect?: (key: string) => void;
  /**
   * Layout for the pill group. `fill` (default) keeps the phone full-width SegmentedControl behaviour
   * for Family/Questions. `intrinsic` hugs content — required for progressive Sub tabs measurement
   * and non-cramped labeled pills when that stage fits (#301).
   */
  layout?: "fill" | "intrinsic";
}

/**
 * HubSubNav (#189) — the shared sub-tab pill row. Renders a set of pills (link OR button) with a
 * single active pill and optional per-item badge, so no tab re-implements the pill mapping. Wrapped
 * in a labelled <nav>. The pill look is the shared _kindred/SegmentedControl `.group`/`.pill` (#1/#5)
 * and the count `.badge` is HubTabs.module.css; the toolbar owns the outer spacing.
 */
export function HubSubNav({
  ariaLabel,
  items,
  active,
  onSelect,
  layout = "fill",
}: HubSubNavProps) {
  const groupClass =
    layout === "intrinsic" ? `${seg.group} ${seg.groupIntrinsic}` : seg.group;

  return (
    <nav className={groupClass} aria-label={ariaLabel}>
      {items.map((item) => {
        const isActive = item.key === active;
        const badge =
          item.badge != null && item.badge > 0 ? (
            <span className={hubTabStyles.badge} aria-label={item.badgeLabel ?? String(item.badge)}>
              {item.badge}
            </span>
          ) : null;

        if (item.href !== undefined) {
          return (
            <Link
              key={item.key}
              href={item.href}
              className={seg.pill}
              aria-current={isActive ? "page" : undefined}
              aria-label={item.ariaLabel}
            >
              {item.label}
              {badge}
            </Link>
          );
        }

        return (
          <button
            key={item.key}
            type="button"
            className={seg.pill}
            aria-current={isActive ? "page" : undefined}
            aria-label={item.ariaLabel}
            onClick={() => onSelect?.(item.key)}
          >
            {item.label}
            {badge}
          </button>
        );
      })}
    </nav>
  );
}
