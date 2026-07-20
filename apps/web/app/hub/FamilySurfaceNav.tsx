"use client";

import type { ReactNode } from "react";
import { UsersRound, UserRoundPlus } from "lucide-react";
import { hub } from "@/app/_copy";
import { FAMILIES_PARAM } from "@/lib/family-filter";
import { HubToolbar } from "./HubToolbar";
import { HubSubNav, type HubSubNavItem } from "./HubSubNav";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { IconSheet } from "./IconSheet";
import { ICON_SHEET_GLYPH_SIZE } from "./icon-sheet-constants";
import { useIsCompact } from "@/app/_kindred/useIsCompact";
import strip from "./HubControlStrip.module.css";

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
  /** The member-only Invite entry point (`/hub?tab=invite[&families=…]`), right-justified on R1 and
   *  present on every sub-tab. `undefined` (a pending-only / gated viewer) renders no button. */
  inviteHref?: string;
  /**
   * Optional second-row slots (#189). The Family CONTENT tabs (tree/list) pass the single-select
   * FamilyChips here (`row2Left`) and, in the tree view, the Fit/−/+ zoom controls (`row2Right`) — both
   * built inside the client FamilyTab, so they're threaded through as ready-made nodes. Omitting both
   * (Requests tab, no-family) collapses the toolbar to R1 only via HubToolbar's empty-row rule.
   *
   * ADR-0025 device round: on a PHONE `row2Left` (the family chips) moves INTO the Family IconSheet on
   * the shared control strip, and `row2Right` (zoom) is NOT rendered here at all — FamilyTab floats the
   * zoom controls onto the tree canvas instead (a bottom sheet would cover the tree you're zooming), so
   * it passes `row2Right={undefined}` on compact.
   */
  row2Left?: ReactNode;
  row2Right?: ReactNode;
}

const SELECTOR: { key: FamilySurfaceView; label: string; tab: string; view?: string }[] = [
  { key: "tree", label: hub.shell.familySubTree, tab: "family", view: "tree" },
  { key: "list", label: hub.tree.viewList, tab: "family", view: "list" },
  { key: "requests", label: hub.shell.tabRequests, tab: "requests" },
];

/**
 * FamilySurfaceNav (#158, #189) — the Family surface's control block. R1 carries the `Family tree · List
 * · Requests` selector (a shared {@link HubSubNav} pill row) + the member-only Invite.
 *
 * DESKTOP (`useIsCompact() === false`, incl. server + first paint): the two-row {@link HubToolbar} —
 * R1 = selector + Invite, R2 = the family selector + zoom controls the content tabs hand in
 * (`row2Left`/`row2Right`), with HubToolbar's empty-row rule dropping R2 on the Requests / no-family
 * path. BYTE-FOR-BYTE unchanged.
 *
 * PHONE: the shared {@link HubControlStrip} layout, consistent with Stories/Album/Questions — the
 * selector pills in `.pills` (visible wayfinding), the family chips (`row2Left`) folded into a Family
 * {@link IconSheet} (≥2 families only), and the Invite action ICONIFIED (UserRoundPlus). Family has NO
 * separate Filter (the chips ARE the family selector = the Family icon) and NO View icon (the zoom
 * controls float on the tree, not a sheet). Selection routing, `?families=`/`?view=` preservation, and
 * the Requests badge are unchanged across both branches.
 */
export function FamilySurfaceNav({
  active,
  familiesParam,
  showRequests,
  requestsBadge,
  inviteHref,
  row2Left,
  row2Right,
}: FamilySurfaceNavProps) {
  const compact = useIsCompact();
  const selector = showRequests ? SELECTOR : SELECTOR.filter((i) => i.key !== "requests");

  function hrefFor(item: (typeof SELECTOR)[number]): string {
    const params = new URLSearchParams({ tab: item.tab });
    if (item.view) params.set("view", item.view);
    if (familiesParam !== null) params.set(FAMILIES_PARAM, familiesParam);
    return `/hub?${params.toString()}`;
  }

  const items: HubSubNavItem[] = selector.map((item) => ({
    key: item.key,
    // Compact uses the SHORT "Tree" so the 3 equal-width pills fit one line beside the icon + Invite;
    // desktop keeps the roomy "Family tree". List/Requests are already short.
    label: item.key === "tree" && compact ? hub.shell.familySubTreeShort : item.label,
    href: hrefFor(item),
    ...(item.key === "requests" && requestsBadge != null && requestsBadge > 0
      ? { badge: requestsBadge, badgeLabel: hub.shell.unreadAria(requestsBadge) }
      : {}),
  }));

  const nav = <HubSubNav ariaLabel={hub.shell.familySubNavAria} items={items} active={active} />;

  if (compact) {
    // Phone: the shared strip — pills (visible) + Family chips sheet (when present) + iconified Invite.
    return (
      <div className={strip.strip}>
        <div className={strip.pills}>{nav}</div>
        <div className={strip.right}>
          {row2Left ? (
            // Increment 4: NO badge here. The Family chips on this tab are a single-select SCOPE (always
            // exactly one family's tree is shown), not a filter that hides content — a badge would be
            // meaningless (there is no "narrowed subset" state; something is always selected).
            <IconSheet
              icon={UsersRound}
              label={hub.mobileControls.familyLabel}
              sheetTitle={hub.mobileControls.familyLabel}
            >
              {row2Left}
            </IconSheet>
          ) : null}
          {inviteHref ? (
            <ActionButton href={inviteHref} aria-label={hub.shell.inviteAria}>
              <UserRoundPlus size={ICON_SHEET_GLYPH_SIZE} strokeWidth={2} aria-hidden />
            </ActionButton>
          ) : null}
        </div>
      </div>
    );
  }

  // Desktop: the unchanged two-row toolbar.
  const invite = inviteHref ? (
    <ActionButton href={inviteHref}>{hub.shell.tabInvite}</ActionButton>
  ) : null;

  return (
    <HubToolbar row1Left={nav} row1Right={invite} row2Left={row2Left} row2Right={row2Right} />
  );
}
