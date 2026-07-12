"use client";

import { useRouter } from "next/navigation";
import { HubTabs } from "./HubTabs";
import type { HubTab } from "./HubTabs";

interface HubTabsNavProps {
  tabs: HubTab[];
  active: string;
  /** The active hub scope ("all" | familyId) — preserved across tab switches. */
  scope: string;
}

/**
 * Thin client wrapper around HubTabs that maps onChange → router.push.
 * Lives here so the hub shell (server component) can import it without
 * needing a "use client" boundary itself. Switching tabs preserves the
 * current `?scope=` so the selected family survives navigation.
 *
 * The "tree" tab is special-cased: it lives on its own route (/hub/tree), not
 * as an in-page ?tab= feed switch, so it navigates there with the scope
 * preserved. Every other tab keeps the existing /hub?tab=<key> behavior.
 */
export function HubTabsNav({ tabs, active, scope }: HubTabsNavProps) {
  const router = useRouter();
  return (
    <HubTabs
      tabs={tabs}
      active={active}
      onChange={(key) =>
        router.push(
          key === "tree"
            ? `/hub/tree?scope=${encodeURIComponent(scope)}`
            : `/hub?tab=${key}&scope=${encodeURIComponent(scope)}`,
        )
      }
    />
  );
}
