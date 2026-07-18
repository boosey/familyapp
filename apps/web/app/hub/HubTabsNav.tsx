"use client";

import { useRouter } from "next/navigation";
import { HubTabs } from "./HubTabs";
import type { HubTab } from "./HubTabs";
import { FAMILIES_PARAM } from "@/lib/family-filter";

interface HubTabsNavProps {
  /** The four primary tabs (Stories · Album · Family · Questions). */
  primaryTabs: HubTab[];
  /** Conditional Invite / Requests entries tucked behind the "More ▾" overflow menu. */
  overflowTabs: HubTab[];
  /** The visually-active PRIMARY key (ask/asks fold onto "questions" in page.tsx). */
  active: string;
  /** The raw current `?families=` browse-filter value (or null when absent) — preserved across tab
   *  switches. Threaded through, never re-derived, so a tab switch never loses the filter. */
  familiesParam: string | null;
}

/**
 * Thin client wrapper around HubTabs that maps onChange → router.push.
 * Lives here so the hub shell (server component) can import it without needing a "use client"
 * boundary itself. Switching tabs (primary OR overflow) preserves the current `?families=` browse
 * filter (ADR-0021) so the selected families survive navigation; the param is OMITTED when absent
 * (absent = all). Every tab is a plain `/hub?tab=<key>` switch — the routing keys are unchanged by
 * the Task-3 de-clutter, only how they're grouped/displayed.
 */
export function HubTabsNav({ primaryTabs, overflowTabs, active, familiesParam }: HubTabsNavProps) {
  const router = useRouter();
  return (
    <HubTabs
      primaryTabs={primaryTabs}
      overflowTabs={overflowTabs}
      active={active}
      onChange={(key) => {
        const params = new URLSearchParams({ tab: key });
        if (familiesParam !== null) params.set(FAMILIES_PARAM, familiesParam);
        router.push(`/hub?${params.toString()}`);
      }}
    />
  );
}
