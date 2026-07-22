/**
 * Hub tab visibility + request-scoping rules (Increment 4B, Task 4.5). Pure helpers shared by the hub
 * shell (page.tsx) and the Requests tab so the membership gating and the scope filter stay in lockstep
 * and are unit-testable without rendering a server component.
 */

/**
 * The Invite tab is a member-only affordance — you invite people INTO a family you belong to. A
 * pending-only viewer (member of no family) has nothing to invite into, so the tab is hidden.
 */
export function inviteTabVisible(activeFamilyCount: number): boolean {
  return activeFamilyCount > 0;
}

/**
 * The Requests tab is the steward's queue. It shows while there are pending OR recently-decided
 * requests AND the viewer is a member of at least one family (a member-of-none stewards nothing).
 */
export function requestsTabVisible(
  activeFamilyCount: number,
  pendingCount: number,
  decidedCount: number,
): boolean {
  return activeFamilyCount > 0 && (pendingCount > 0 || decidedCount > 0);
}

/** The Family-tab badge = the steward's actionable pending-request count; hidden (undefined) at zero
 *  so decided-only queues don't badge the tab. */
export function familyTabBadge(pendingCount: number): number | undefined {
  return pendingCount > 0 ? pendingCount : undefined;
}

/**
 * Narrow steward-side request rows to the hub scope: "all" aggregates across every family the steward
 * stewards (each row carries its own `familyName` for labeling); a family scope keeps only that
 * family's rows.
 */
export function requestsInScope<T extends { familyId: string }>(rows: T[], scope: string): T[] {
  return scope === "all" ? rows : rows.filter((r) => r.familyId === scope);
}

/**
 * Per-family pending-request chip badges for the Requests progressive Family unit (#140 / #297).
 * Returns serializable maps only — never a formatter fn — so Server Components can pass them across
 * the RSC boundary into client `<FamilyChips>` without Flight 500s.
 */
export function pendingRequestChipBadges(
  pending: ReadonlyArray<{ familyId: string }>,
  labelFor: (count: number) => string,
): { badges: Record<string, number>; badgeLabels: Record<string, string> } {
  const badges = pending.reduce<Record<string, number>>((acc, r) => {
    acc[r.familyId] = (acc[r.familyId] ?? 0) + 1;
    return acc;
  }, {});
  const badgeLabels = Object.fromEntries(
    Object.entries(badges).map(([familyId, count]) => [familyId, labelFor(count)]),
  );
  return { badges, badgeLabels };
}
