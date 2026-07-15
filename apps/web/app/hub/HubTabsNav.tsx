"use client";

import { useRouter } from "next/navigation";
import { HubTabs } from "./HubTabs";
import type { HubTab } from "./HubTabs";
import { FAMILIES_PARAM } from "@/lib/family-filter";

interface HubTabsNavProps {
  tabs: HubTab[];
  active: string;
  /** The raw current `?families=` browse-filter value (or null when absent) — preserved across tab
   *  switches. Threaded through, never re-derived, so a tab switch never loses the filter. */
  familiesParam: string | null;
}

/**
 * Thin client wrapper around HubTabs that maps onChange → router.push.
 * Lives here so the hub shell (server component) can import it without needing a "use client"
 * boundary itself. Switching tabs preserves the current `?families=` browse filter (ADR-0021) so the
 * selected families survive navigation; the param is OMITTED when absent (absent = all). Every tab —
 * including the Family tab (formerly the standalone /hub/tree route) — is a plain `/hub?tab=<key>`
 * switch.
 */
export function HubTabsNav({ tabs, active, familiesParam }: HubTabsNavProps) {
  const router = useRouter();
  return (
    <HubTabs
      tabs={tabs}
      active={active}
      onChange={(key) => {
        const params = new URLSearchParams({ tab: key });
        if (familiesParam !== null) params.set(FAMILIES_PARAM, familiesParam);
        router.push(`/hub?${params.toString()}`);
      }}
    />
  );
}
