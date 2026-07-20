"use client";

import { useRouter } from "next/navigation";
import { HubTabs } from "./HubTabs";
import type { HubTab } from "./HubTabs";
import { BottomTabBar } from "./BottomTabBar";
import { useIsCompact } from "@/app/_kindred/useIsCompact";
import { FAMILIES_PARAM } from "@/lib/family-filter";
import pageStyles from "./page.module.css";

interface HubPrimaryNavProps {
  /** The four primary tabs (Stories · Album · Family · Questions). */
  primaryTabs: HubTab[];
  /** The visually-active PRIMARY key (ask/asks fold onto "questions", requests onto "family",
   *  in page.tsx). */
  active: string;
  /** The raw current `?families=` browse-filter value (or null when absent) — preserved across tab
   *  switches. Threaded through, never re-derived, so a tab switch never loses the filter. */
  familiesParam: string | null;
}

/**
 * ADR-0025 mobile Phase B, Increment 1 — the primary-nav branch.
 *
 * Owns the SINGLE shared navigation behaviour (the `?tab=` push that preserves `?families=`) and swaps
 * only its skin by viewport:
 *  - desktop (`useIsCompact() === false`, incl. the server + first-paint snapshot) → the existing top
 *    {@link HubTabs} pill row inside `styles.tabsRow` — byte-for-byte what the hub rendered before, so
 *    desktop never regresses and there is no hydration mismatch;
 *  - phone (`true`, corrected once after hydration) → the fixed {@link BottomTabBar}, and the top row is
 *    NOT rendered at all (no empty bordered gap left behind).
 *
 * This replaces the former inline top-tabs wrapper in page.tsx; the desktop router-push behaviour is
 * subsumed here so the compact/desktop swap lives in one place, consistent with the `useIsCompact`
 * swap pattern used elsewhere in the hub tabs.
 */
export function HubPrimaryNav({ primaryTabs, active, familiesParam }: HubPrimaryNavProps) {
  const router = useRouter();
  const compact = useIsCompact();

  const onChange = (key: string) => {
    const params = new URLSearchParams({ tab: key });
    if (familiesParam !== null) params.set(FAMILIES_PARAM, familiesParam);
    router.push(`/hub?${params.toString()}`);
  };

  if (compact) {
    return <BottomTabBar primaryTabs={primaryTabs} active={active} onChange={onChange} />;
  }

  return (
    <div className={pageStyles.tabsRow}>
      <HubTabs primaryTabs={primaryTabs} active={active} onChange={onChange} />
    </div>
  );
}
