"use client";

/**
 * FamilySurfaceNav (#297) — Family surface owner of the progressive hub control row.
 *
 * Occupancy: Sub tabs (Tree / List / Requests) → Family (scope chips when multi-family) → Views
 * (zoom/fit on tree). No Search/Filters. Invite stays on the trailing edge outside collapse.
 * One progressive row on every width — no HubToolbar / compact-strip swap.
 *
 * Call sites: FamilyTab (tree/list, with chips + zoom), RequestsTab (chips when ≥2 families; no
 * Views), and the hub page no-family fallback (Sub tabs + Invite only).
 */
import type { ComponentProps, ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Inbox,
  List,
  Network,
  UserRoundPlus,
  UsersRound,
  ZoomIn,
} from "lucide-react";
import { hub } from "@/app/_copy";
import { FAMILIES_PARAM } from "@/lib/family-filter";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { HubProgressiveControlRow } from "./HubProgressiveControlRow";
import { HubSubNav, type HubSubNavItem } from "./HubSubNav";
import { IconSheet } from "./IconSheet";
import { ICON_SHEET_GLYPH_SIZE } from "./icon-sheet-constants";
import { HUB_SUB_TABS_GLYPH_SIZE } from "./hub-progressive-control-constants";
import { SubTabsMenu } from "./SubTabsMenu";

/** The active Family-surface view the selector highlights. */
export type FamilySurfaceView = "tree" | "list" | "requests";

interface FamilySurfaceNavProps {
  /** Which selector item is active (`aria-current="page"`). */
  active: FamilySurfaceView;
  /** The raw current `?families=` browse-filter value (or null when absent) — preserved on every
   *  selector navigation, mirroring HubPrimaryNav / the old FamilySubNav. */
  familiesParam: string | null;
  /** Include the Requests item. Gated upstream to a steward with a live queue (or a Requests deep-link)
   *  so a plain member never sees a link into an empty steward surface. */
  showRequests: boolean;
  /** The steward's TOTAL pending join-request count across every family they steward — badges the
   *  Requests item; absent/0 hides the badge. Deliberately the aggregate (not the scoped subset) so a
   *  steward still sees that requests exist in a family they haven't selected (#159). */
  requestsBadge?: number;
  /** The member-only Invite entry point (`/hub?tab=invite[&families=…]`), trailing primary action.
   *  `undefined` (a pending-only / gated viewer) renders no button. */
  inviteHref?: string;
  /**
   * Family unit — single-select scope chips when ≥2 families. Omit on single-family / no-family so the
   * unit is absent (not an empty icon). RequestsTab and FamilyTab both pass chips when multi-family.
   */
  row2Left?: ReactNode;
  /**
   * Views unit — Fit/−/+ zoom controls (tree view only). Omit on List/Requests. Collapsed form is an
   * IconSheet (sheet on compact, popover on wide per #300).
   */
  row2Right?: ReactNode;
  /** Test seam: force progressive-row width (skips ResizeObserver). */
  forceAvailableWidth?: number;
  /** Test seam: skip DOM measurement and use these widths. */
  forceWidths?: ComponentProps<typeof HubProgressiveControlRow>["forceWidths"];
}

const SELECTOR: { key: FamilySurfaceView; label: string; tab: string; view?: string }[] = [
  { key: "tree", label: hub.shell.familySubTree, tab: "family", view: "tree" },
  { key: "list", label: hub.tree.viewList, tab: "family", view: "list" },
  { key: "requests", label: hub.shell.tabRequests, tab: "requests" },
];

function hrefFor(
  item: (typeof SELECTOR)[number],
  familiesParam: string | null,
): string {
  const params = new URLSearchParams({ tab: item.tab });
  if (item.view) params.set("view", item.view);
  if (familiesParam !== null) params.set(FAMILIES_PARAM, familiesParam);
  return `/hub?${params.toString()}`;
}

export function FamilySurfaceNav({
  active,
  familiesParam,
  showRequests,
  requestsBadge,
  inviteHref,
  row2Left,
  row2Right,
  forceAvailableWidth,
  forceWidths,
}: FamilySurfaceNavProps) {
  const router = useRouter();
  const selector = showRequests ? SELECTOR : SELECTOR.filter((i) => i.key !== "requests");

  function requestsBadgeProps(key: FamilySurfaceView): {
    badge?: number;
    badgeLabel?: string;
  } {
    if (key !== "requests" || requestsBadge == null || requestsBadge <= 0) return {};
    return { badge: requestsBadge, badgeLabel: hub.shell.unreadAria(requestsBadge) };
  }

  function requestsAriaLabel(key: FamilySurfaceView, base: string): string {
    const badge = requestsBadgeProps(key);
    return badge.badgeLabel ? `${base}, ${badge.badgeLabel}` : base;
  }

  const labeledItems: HubSubNavItem[] = selector.map((item) => ({
    key: item.key,
    // Labeled stage: short "Tree" keeps three pills measurable without wrapping (same bet as the
    // old compact strip); List/Requests are already short.
    label: item.key === "tree" ? hub.shell.familySubTreeShort : item.label,
    href: hrefFor(item, familiesParam),
    ...requestsBadgeProps(item.key),
  }));

  const iconPillItems: HubSubNavItem[] = selector.map((item) => {
    const icon =
      item.key === "tree" ? (
        <Network size={HUB_SUB_TABS_GLYPH_SIZE} strokeWidth={2} aria-hidden />
      ) : item.key === "list" ? (
        <List size={HUB_SUB_TABS_GLYPH_SIZE} strokeWidth={2} aria-hidden />
      ) : (
        <Inbox size={HUB_SUB_TABS_GLYPH_SIZE} strokeWidth={2} aria-hidden />
      );
    const baseAria =
      item.key === "tree"
        ? hub.mobileControls.modeTreeAria
        : item.key === "list"
          ? hub.mobileControls.modeListAria
          : hub.mobileControls.modeRequestsAria;
    return {
      key: item.key,
      label: icon,
      href: hrefFor(item, familiesParam),
      // Fold badge into aria-label — HubSubNav's ariaLabel replaces the accessible name from children.
      ariaLabel: requestsAriaLabel(item.key, baseAria),
      ...requestsBadgeProps(item.key),
    };
  });

  const menuItems = selector.map((item) => ({
    key: item.key,
    label: item.label,
    ...requestsBadgeProps(item.key),
  }));

  const family =
    row2Left != null
      ? {
          expanded: row2Left,
          collapsed: (
            // Single-select scope — never badge (there is no "narrowed subset"; something is always on).
            <IconSheet
              icon={UsersRound}
              label={hub.mobileControls.familyLabel}
              sheetTitle={hub.mobileControls.familyLabel}
            >
              {row2Left}
            </IconSheet>
          ),
        }
      : undefined;

  const views =
    row2Right != null
      ? {
          expanded: row2Right,
          collapsed: (
            <IconSheet
              icon={ZoomIn}
              label={hub.mobileControls.viewLabel}
              sheetTitle={hub.mobileControls.viewLabel}
            >
              {row2Right}
            </IconSheet>
          ),
        }
      : undefined;

  const action = inviteHref
    ? {
        labeled: <ActionButton href={inviteHref}>{hub.shell.tabInvite}</ActionButton>,
        iconified: (
          <ActionButton href={inviteHref} aria-label={hub.shell.inviteAria}>
            <UserRoundPlus size={ICON_SHEET_GLYPH_SIZE} strokeWidth={2} aria-hidden />
          </ActionButton>
        ),
      }
    : undefined;

  return (
    <HubProgressiveControlRow
      subTabs={{
        labeled: (
          <HubSubNav
            layout="intrinsic"
            ariaLabel={hub.shell.familySubNavAria}
            items={labeledItems}
            active={active}
          />
        ),
        iconPills: (
          <HubSubNav
            layout="intrinsic"
            ariaLabel={hub.shell.familySubNavAria}
            items={iconPillItems}
            active={active}
          />
        ),
        menuIcon: (
          <SubTabsMenu
            items={menuItems}
            active={active}
            ariaLabel={hub.shell.familySubNavAria}
            onSelect={(key) => {
              const item = selector.find((i) => i.key === key);
              if (!item) return;
              router.push(hrefFor(item, familiesParam));
            }}
          />
        ),
      }}
      family={family}
      views={views}
      action={action}
      forceAvailableWidth={forceAvailableWidth}
      forceWidths={forceWidths}
    />
  );
}
