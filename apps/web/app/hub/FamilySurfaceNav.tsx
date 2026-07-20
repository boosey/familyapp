import type { ReactNode } from "react";
import { hub } from "@/app/_copy";
import { FAMILIES_PARAM } from "@/lib/family-filter";
import { HubToolbar } from "./HubToolbar";
import { HubSubNav, type HubSubNavItem } from "./HubSubNav";
import { ActionButton } from "@/app/_kindred/ActionButton";

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
 * FamilySurfaceNav (#158, #189) — the Family surface's adoption of the shared two-row {@link HubToolbar}
 * (the reference migration in #189). R1 carries the `Family tree · List · Requests` selector (a shared
 * {@link HubSubNav} pill row) on the left and the member-only Invite button right-justified. R2 carries
 * the family selector + view controls the content tabs hand in (`row2Left`/`row2Right`) — omitted on the
 * Requests tab and the no-family case, where HubToolbar's empty-row rule drops R2 entirely (content
 * stays flush, no reserved gap).
 *
 * Selection is URL-driven so each selector item is a real Next.js `<Link>` (middle-click / open-in-new-
 * tab / prefetch for free): Family tree → `?tab=family&view=tree`, List → `?tab=family&view=list`,
 * Requests → `?tab=requests`. `?families=` is preserved on every navigation (omitted when absent).
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
  const selector = showRequests ? SELECTOR : SELECTOR.filter((i) => i.key !== "requests");

  function hrefFor(item: (typeof SELECTOR)[number]): string {
    const params = new URLSearchParams({ tab: item.tab });
    if (item.view) params.set("view", item.view);
    if (familiesParam !== null) params.set(FAMILIES_PARAM, familiesParam);
    return `/hub?${params.toString()}`;
  }

  const items: HubSubNavItem[] = selector.map((item) => ({
    key: item.key,
    label: item.label,
    href: hrefFor(item),
    ...(item.key === "requests" && requestsBadge != null && requestsBadge > 0
      ? { badge: requestsBadge, badgeLabel: hub.shell.unreadAria(requestsBadge) }
      : {}),
  }));

  const nav = <HubSubNav ariaLabel={hub.shell.familySubNavAria} items={items} active={active} />;

  const invite = inviteHref ? (
    <ActionButton href={inviteHref}>{hub.shell.tabInvite}</ActionButton>
  ) : null;

  return (
    <HubToolbar row1Left={nav} row1Right={invite} row2Left={row2Left} row2Right={row2Right} />
  );
}
