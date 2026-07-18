import Link from "next/link";
import { hub } from "@/app/_copy";
import { FAMILIES_PARAM } from "@/lib/family-filter";
import hubTabStyles from "./HubTabs.module.css";
import styles from "./FamilySurfaceNav.module.css";

/** The active Family-surface view the selector highlights. */
export type FamilySurfaceView = "tree" | "list" | "requests";

interface FamilySurfaceNavProps {
  /** Which selector item is active (`aria-current="page"`). */
  active: FamilySurfaceView;
  /** The raw current `?families=` browse-filter value (or null when absent) — preserved on every
   *  selector navigation, mirroring HubTabsNav / the old FamilySubNav. */
  familiesParam: string | null;
  /** Include the Requests item. Gated upstream to a steward with a live queue (or a Requests deep-link)
   *  so a plain member never sees a link into an empty steward surface. */
  showRequests: boolean;
  /** The steward's TOTAL pending join-request count across every family they steward — badges the
   *  Requests item; absent/0 hides the badge. Deliberately the aggregate (not the scoped subset) so a
   *  steward still sees that requests exist in a family they haven't selected (#159). */
  requestsBadge?: number;
  /** The member-only Invite entry point (`/hub?tab=invite[&families=…]`), right-justified on the row and
   *  present on every sub-tab. `undefined` (a pending-only / gated viewer) renders no button. */
  inviteHref?: string;
}

const SELECTOR: { key: FamilySurfaceView; label: string; tab: string; view?: string }[] = [
  { key: "tree", label: hub.shell.familySubTree, tab: "family", view: "tree" },
  { key: "list", label: hub.tree.viewList, tab: "family", view: "list" },
  { key: "requests", label: hub.shell.tabRequests, tab: "requests" },
];

/**
 * FamilySurfaceNav (#158) — the single selector row shared by all three Family sub-tabs: Family tree ·
 * List · Requests, with the member-only Invite button right-justified on the same row. It replaces two
 * older controls at once — the page-level two-way sub-nav (`FamilySubNav`) and the in-tree `Tree | List`
 * pill (which lived inside `FamilyTab` and toggled via localStorage).
 *
 * Selection is URL-driven so each item is a real Next.js `<Link>` (middle-click / open-in-new-tab /
 * prefetch for free, no client boundary): Family tree → `?tab=family&view=tree`, List →
 * `?tab=family&view=list`, Requests → `?tab=requests`. `?families=` is preserved on every navigation
 * (omitted when absent), the same way HubTabsNav / QuestionsSubNav do.
 */
export function FamilySurfaceNav({
  active,
  familiesParam,
  showRequests,
  requestsBadge,
  inviteHref,
}: FamilySurfaceNavProps) {
  const items = showRequests ? SELECTOR : SELECTOR.filter((i) => i.key !== "requests");

  function hrefFor(item: (typeof SELECTOR)[number]): string {
    const params = new URLSearchParams({ tab: item.tab });
    if (item.view) params.set("view", item.view);
    if (familiesParam !== null) params.set(FAMILIES_PARAM, familiesParam);
    return `/hub?${params.toString()}`;
  }

  return (
    <div className={styles.row}>
      <nav className={styles.selectorNav} aria-label={hub.shell.familySubNavAria}>
        {items.map((item) => (
          <Link
            key={item.key}
            href={hrefFor(item)}
            className={hubTabStyles.subLink}
            aria-current={item.key === active ? "page" : undefined}
          >
            {item.label}
            {item.key === "requests" && requestsBadge != null && requestsBadge > 0 && (
              <span className={hubTabStyles.badge} aria-label={hub.shell.unreadAria(requestsBadge)}>
                {requestsBadge}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {inviteHref ? (
        <a className={styles.inviteButton} href={inviteHref}>
          {hub.shell.tabInvite}
        </a>
      ) : null}
    </div>
  );
}
