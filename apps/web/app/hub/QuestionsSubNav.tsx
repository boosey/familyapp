"use client";

import { useRouter } from "next/navigation";
import { hub } from "@/app/_copy";
import { FAMILIES_PARAM } from "@/lib/family-filter";
import { HubToolbar } from "./HubToolbar";
import { HubSubNav, type HubSubNavItem } from "./HubSubNav";

interface QuestionsSubNavProps {
  /** The active ask surface key: "questions" (To answer), "ask", or "asks". */
  active: string;
  /** The raw current `?families=` browse-filter value (or null when absent) — preserved on switch,
   *  mirroring HubPrimaryNav. */
  familiesParam: string | null;
  /** #142: the viewer's pending-ask count — badges the "To answer" sub-link; absent/0 hides the badge.
   *  Mirrors the top-level Questions tab badge (same `listPendingAsksForNarrator` count). */
  toAnswerBadge?: number;
}

const SUB_TABS = [
  { key: "questions", label: hub.shell.questionsSubToAnswer },
  { key: "ask", label: hub.shell.questionsSubAsk },
  { key: "asks", label: hub.shell.questionsSubYourAsks },
] as const;

/**
 * QuestionsSubNav (Task 3, #189, #192) — the Questions surface's adoption of the shared two-row
 * {@link HubToolbar}. The three ask surfaces (To answer = `questions`, Ask a question = `ask`, Your asks
 * = `asks`) live under one primary tab; this row switches among them. It renders as an R1-left
 * {@link HubSubNav} pill row (the single-sourced pill style) — with NO R1-right action and NO R2 row, so
 * HubToolbar's empty-row rule drops the second row entirely (no reserved vertical space) and the pills
 * sit flush against the list below.
 *
 * Behaviour is unchanged: selection is client-driven (`router.push`) to the SAME existing
 * `?tab=questions|ask|asks` keys, preserving `?families=` the way HubPrimaryNav does (omitted when absent).
 * The per-key content in page.tsx is unchanged. The #142 pending-ask badge on "To answer" is preserved.
 */
export function QuestionsSubNav({ active, familiesParam, toAnswerBadge }: QuestionsSubNavProps) {
  const router = useRouter();

  const items: HubSubNavItem[] = SUB_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    ...(tab.key === "questions" && toAnswerBadge != null && toAnswerBadge > 0
      ? { badge: toAnswerBadge, badgeLabel: hub.shell.unreadAria(toAnswerBadge) }
      : {}),
  }));

  const nav = (
    <HubSubNav
      ariaLabel={hub.shell.questionsSubNavAria}
      items={items}
      active={active}
      onSelect={(key) => {
        const params = new URLSearchParams({ tab: key });
        if (familiesParam !== null) params.set(FAMILIES_PARAM, familiesParam);
        router.push(`/hub?${params.toString()}`);
      }}
    />
  );

  // R1-left only: no R1-right action, and both R2 slots omitted so the second row never renders.
  return <HubToolbar row1Left={nav} />;
}
