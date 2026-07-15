/**
 * Action-flow family DESIGNATOR resolution (ADR-0021, issue #49).
 *
 * A browse FILTER writes to `?families=`; an action DESIGNATOR does NOT write back — it is the flow's
 * OWN client state, SEEDED from the current filter, resolving ONE operating family. Invite and Ask
 * each carry a single-select designator: they operate on exactly one family, so unlike the compose
 * multi-select these helpers settle on a single id (or null when the user must deliberately pick).
 *
 * These are pure so the UI seed and the server-side backstop stay in lockstep and are unit-testable
 * without a request. `activeFamilyIds` is always the viewer's OWN active families (already trusted,
 * active-set order). Membership in the resolved family is NOT re-checked here — the domain write path
 * (createInvitation / createLinkSession / createAsk) owns that gate transactionally.
 */

import type { FamilyFilter } from "./family-filter";

/**
 * The single family an action flow (Invite / Ask) should DEFAULT to, seeded from the browse filter
 * (ADR-0021 designator) — or null when there is no unambiguous default and the user must pick.
 * Rules (single-select):
 *   - viewer has exactly one active family        → that family (always unambiguous)
 *   - filter names exactly one family (some[1])   → that family
 *   - filter is "all"/"none"/multi with >1 family → null (force a deliberate pick)
 * `activeFamilyIds` is the viewer's OWN active families (already trusted, active-set order).
 */
export function seedDesignatorFamily(
  filter: FamilyFilter,
  activeFamilyIds: string[],
): string | null {
  if (activeFamilyIds.length === 1) return activeFamilyIds[0]!;
  if (filter.kind === "some" && filter.ids.length === 1) return filter.ids[0]!;
  return null;
}

/**
 * Resolve the single designated family a submitted action targets, against the viewer's OWN active
 * families (defense in depth — the domain re-checks). Returns `string | null`:
 *   - a deliberate pick of a family the viewer is in → that id
 *   - empty (or a bogus non-member id) + exactly one family → the lone id (unambiguous)
 *   - empty + ZERO active families → null (NO family context — the caller may legitimately have none)
 *   - empty/ambiguous + several families → THROWS (refuse rather than target an arbitrary one)
 *
 * The zero-family case returns null rather than throwing because the Ask flow TOLERATES a familyless
 * ask (core's createAsk documents "Absent/empty ⇒ an ask with no family context"), and a pending-only
 * viewer (0 active families, a join request in flight) IS admitted to the hub and reaches submitAsk
 * with no member-only gate. Invite, by contrast, is member-gated in page.tsx (`activeFamilies.length >
 * 0`) so it never reaches this with zero — and it uses its own resolveInviteFamilyId, which still
 * throws on zero. The Ask caller wraps a non-null id in a one-element array and passes nothing when
 * null, restoring the pre-#49 behaviour (`resolveComposeFamilies([], []) → []`).
 */
export function resolveDesignatorFamily(
  chosen: string,
  activeFamilyIds: string[],
): string | null {
  const picked = chosen.trim();
  // A deliberate pick of a family the viewer is actually in — the normal path.
  if (picked && activeFamilyIds.includes(picked)) return picked;
  // Empty (or a bogus non-member id) collapses to the lone family when there is exactly one — the
  // only family they could possibly act on, so it is unambiguous and safe.
  if (activeFamilyIds.length === 1) return activeFamilyIds[0]!;
  // Empty with ZERO families → no family context (a familyless ask; not an error for the Ask flow).
  if (activeFamilyIds.length === 0) return null;
  // Empty/ambiguous with several families → refuse rather than target an arbitrary one.
  throw new Error("Choose a family for this action.");
}
