import Link from "next/link";
import { hub } from "@/app/_copy";
import { FAMILIES_PARAM } from "@/lib/family-filter";
import styles from "./HubTabs.module.css";

interface FamilySubNavProps {
  /** The active Family-surface key: "family" (the tree + relatives) or "requests" (the steward queue). */
  active: string;
  /** The raw current `?families=` browse-filter value (or null when absent) — preserved on switch,
   *  mirroring HubTabsNav. */
  familiesParam: string | null;
  /** The steward's pending join-request count — badges the Requests sub-link; absent/0 hides the badge. */
  requestsBadge?: number;
}

const SUB_TABS = [
  { key: "family", label: hub.shell.familySubTree },
  { key: "requests", label: hub.shell.tabRequests },
] as const;

/**
 * Issue #124 (Playful de-clutter): the secondary sub-nav inside the consolidated Family primary tab.
 * The steward's Requests queue (formerly a "More ▾" overflow entry) now folds under the Family tab —
 * this row switches between the family tree/relatives and the Requests queue. Presentation only — it
 * routes to the SAME existing `?tab=family|requests` keys, preserving `?families=` the same way
 * QuestionsSubNav / HubTabsNav do (omitted when absent). The per-key content in page.tsx is unchanged.
 *
 * Issue #134: these are real Next.js `<Link>`s (not `router.push` buttons) — actual anchors give
 * middle-click / open-in-new-tab / prefetch for free, and no client boundary is needed here.
 */
export function FamilySubNav({ active, familiesParam, requestsBadge }: FamilySubNavProps) {
  return (
    <nav className={styles.subNav} aria-label={hub.shell.familySubNavAria}>
      {SUB_TABS.map((tab) => {
        const params = new URLSearchParams({ tab: tab.key });
        if (familiesParam !== null) params.set(FAMILIES_PARAM, familiesParam);
        return (
          <Link
            key={tab.key}
            href={`/hub?${params.toString()}`}
            className={styles.subLink}
            aria-current={tab.key === active ? "page" : undefined}
          >
            {tab.label}
            {tab.key === "requests" && requestsBadge != null && requestsBadge > 0 && (
              <span className={styles.badge} aria-label={hub.shell.unreadAria(requestsBadge)}>
                {requestsBadge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
