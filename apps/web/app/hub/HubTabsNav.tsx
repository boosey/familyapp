"use client";

import { useRouter } from "next/navigation";
import { HubTabs } from "./HubTabs";
import type { HubTab } from "./HubTabs";

interface HubTabsNavProps {
  tabs: HubTab[];
  active: string;
}

/**
 * Thin client wrapper around HubTabs that maps onChange → router.push.
 * Lives here so the hub shell (server component) can import it without
 * needing a "use client" boundary itself.
 */
export function HubTabsNav({ tabs, active }: HubTabsNavProps) {
  const router = useRouter();
  return (
    <HubTabs
      tabs={tabs}
      active={active}
      onChange={(key) => router.push(`/hub?tab=${key}`)}
    />
  );
}
