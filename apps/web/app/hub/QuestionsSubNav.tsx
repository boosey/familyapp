"use client";

import { useRouter } from "next/navigation";
import { hub } from "@/app/_copy";
import { FAMILIES_PARAM } from "@/lib/family-filter";
import styles from "./HubTabs.module.css";

interface QuestionsSubNavProps {
  /** The active ask surface key: "questions" (To answer), "ask", or "asks". */
  active: string;
  /** The raw current `?families=` browse-filter value (or null when absent) — preserved on switch,
   *  mirroring HubTabsNav. */
  familiesParam: string | null;
}

const SUB_TABS = [
  { key: "questions", label: hub.shell.questionsSubToAnswer },
  { key: "ask", label: hub.shell.questionsSubAsk },
  { key: "asks", label: hub.shell.questionsSubYourAsks },
] as const;

/**
 * Task 3 (Playful de-clutter): the secondary sub-nav inside the consolidated Questions primary tab.
 * The three ask surfaces (To answer = `questions`, Ask a question = `ask`, Your asks = `asks`) now
 * live under one primary tab; this row switches among them. Presentation only — it routes to the
 * SAME existing `?tab=questions|ask|asks` keys, preserving `?families=` the same way HubTabsNav does
 * (omitted when absent). The per-key content in page.tsx is unchanged.
 */
export function QuestionsSubNav({ active, familiesParam }: QuestionsSubNavProps) {
  const router = useRouter();
  return (
    <nav className={styles.subNav} aria-label={hub.shell.questionsSubNavAria}>
      {SUB_TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={styles.subLink}
          aria-current={tab.key === active ? "page" : undefined}
          onClick={() => {
            const params = new URLSearchParams({ tab: tab.key });
            if (familiesParam !== null) params.set(FAMILIES_PARAM, familiesParam);
            router.push(`/hub?${params.toString()}`);
          }}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
