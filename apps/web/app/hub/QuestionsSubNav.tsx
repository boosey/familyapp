"use client";

/**
 * QuestionsSubNav (#297) — Questions surface owner of the progressive hub control row.
 *
 * Occupancy: Sub tabs only (To answer / Ask / Your asks). No Family/Search/Filters/Views and no
 * trailing primary action. One progressive row on every width — no HubToolbar / compact-strip swap.
 */
import type { ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { CircleHelp, MessageSquarePlus, MessagesSquare } from "lucide-react";
import { hub } from "@/app/_copy";
import { FAMILIES_PARAM } from "@/lib/family-filter";
import { HubProgressiveControlRow } from "./HubProgressiveControlRow";
import { HubSubNav, type HubSubNavItem } from "./HubSubNav";
import { HUB_SUB_TABS_GLYPH_SIZE } from "./hub-progressive-control-constants";
import { SubTabsMenu } from "./SubTabsMenu";

interface QuestionsSubNavProps {
  /** The active ask surface key: "questions" (To answer), "ask", or "asks". */
  active: string;
  /** The raw current `?families=` browse-filter value (or null when absent) — preserved on switch,
   *  mirroring HubPrimaryNav. */
  familiesParam: string | null;
  /** #142: the viewer's pending-ask count — badges the "To answer" sub-link; absent/0 hides the badge.
   *  Mirrors the top-level Questions tab badge (same `listPendingAsksForNarrator` count). */
  toAnswerBadge?: number;
  /** Test seam: force progressive-row width (skips ResizeObserver). */
  forceAvailableWidth?: number;
  /** Test seam: skip DOM measurement and use these widths. */
  forceWidths?: ComponentProps<typeof HubProgressiveControlRow>["forceWidths"];
}

const SUB_TABS = [
  { key: "questions", label: hub.shell.questionsSubToAnswer },
  { key: "ask", label: hub.shell.questionsSubAsk },
  { key: "asks", label: hub.shell.questionsSubYourAsks },
] as const;

export function QuestionsSubNav({
  active,
  familiesParam,
  toAnswerBadge,
  forceAvailableWidth,
  forceWidths,
}: QuestionsSubNavProps) {
  const router = useRouter();

  function navigate(key: string) {
    const params = new URLSearchParams({ tab: key });
    if (familiesParam !== null) params.set(FAMILIES_PARAM, familiesParam);
    router.push(`/hub?${params.toString()}`);
  }

  function toAnswerBadgeProps(key: string): { badge?: number; badgeLabel?: string } {
    if (key !== "questions" || toAnswerBadge == null || toAnswerBadge <= 0) return {};
    return { badge: toAnswerBadge, badgeLabel: hub.shell.unreadAria(toAnswerBadge) };
  }

  function toAnswerAriaLabel(key: string, base: string): string {
    const badge = toAnswerBadgeProps(key);
    return badge.badgeLabel ? `${base}, ${badge.badgeLabel}` : base;
  }

  const labeledItems: HubSubNavItem[] = SUB_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    ...toAnswerBadgeProps(tab.key),
  }));

  const iconPillItems: HubSubNavItem[] = SUB_TABS.map((tab) => {
    const icon =
      tab.key === "questions" ? (
        <CircleHelp size={HUB_SUB_TABS_GLYPH_SIZE} strokeWidth={2} aria-hidden />
      ) : tab.key === "ask" ? (
        <MessageSquarePlus size={HUB_SUB_TABS_GLYPH_SIZE} strokeWidth={2} aria-hidden />
      ) : (
        <MessagesSquare size={HUB_SUB_TABS_GLYPH_SIZE} strokeWidth={2} aria-hidden />
      );
    return {
      key: tab.key,
      label: icon,
      // Fold badge into aria-label — HubSubNav's ariaLabel replaces the accessible name from children.
      ariaLabel: toAnswerAriaLabel(tab.key, tab.label),
      ...toAnswerBadgeProps(tab.key),
    };
  });

  const menuItems = SUB_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    ...toAnswerBadgeProps(tab.key),
  }));

  return (
    <HubProgressiveControlRow
      subTabs={{
        labeled: (
          <HubSubNav
            layout="intrinsic"
            ariaLabel={hub.shell.questionsSubNavAria}
            items={labeledItems}
            active={active}
            onSelect={navigate}
          />
        ),
        iconPills: (
          <HubSubNav
            layout="intrinsic"
            ariaLabel={hub.shell.questionsSubNavAria}
            items={iconPillItems}
            active={active}
            onSelect={navigate}
          />
        ),
        menuIcon: (
          <SubTabsMenu
            items={menuItems}
            active={active}
            ariaLabel={hub.shell.questionsSubNavAria}
            onSelect={navigate}
          />
        ),
      }}
      forceAvailableWidth={forceAvailableWidth}
      forceWidths={forceWidths}
    />
  );
}
