/**
 * Compose-time family targeting resolved from the hub scope (Increment 4B, Task 4.4).
 *
 * The single compose scope ("all" | a viewer's OWN active family id) is derived from the shared
 * `?families=` browse filter (ADR-0021) via deriveSingleScope. Content WRITES (an Ask, and — where
 * wired — a story's family target) accept
 * one-or-more families: unambiguous cases are auto-resolved, and only the genuinely ambiguous case
 * ("all" with several families) forces an explicit choice. These pure helpers hold that rule so the
 * server action and the UI seeding stay in lockstep and are unit-testable without a request.
 */

/**
 * Which families to PRE-CHECK in the compose multi-select, seeded from the hub scope:
 *   - scope is a family id → that family (if it is one the viewer is actually in);
 *   - "all" + exactly one family → that lone family (auto-seeded);
 *   - "all" + several → nothing pre-checked; the narrator must choose.
 */
export function seedComposeFamilies(scope: string, activeFamilyIds: string[]): Set<string> {
  if (scope !== "all") {
    return new Set(activeFamilyIds.includes(scope) ? [scope] : []);
  }
  if (activeFamilyIds.length === 1) return new Set([activeFamilyIds[0]!]);
  return new Set();
}

/**
 * True when the narrator must EXPLICITLY pick ≥1 family — i.e. the ambiguous "all"-with-several case.
 * Drives whether the multi-select is required (client hint) and whether the empty-selection server
 * guard bites.
 */
export function familyChoiceRequired(scope: string, activeFamilyIds: string[]): boolean {
  return scope === "all" && activeFamilyIds.length > 1;
}

/**
 * Resolve the family ids a submitted compose action should carry to the write path. Client-supplied
 * ids are intersected with the viewer's OWN active families (defense in depth — createAsk re-checks
 * too), then:
 *   - a non-empty valid selection → those ids (deduped);
 *   - an empty selection with exactly one family → that lone family (auto-resolved);
 *   - an empty selection with no families → [] (a pending-only user can't reach the write path anyway);
 *   - an empty selection with several families → THROWS (the server-side guard).
 */
export function resolveComposeFamilies(chosen: string[], activeFamilyIds: string[]): string[] {
  const valid = [...new Set(chosen.filter((f) => activeFamilyIds.includes(f)))];
  if (valid.length > 0) return valid;
  if (activeFamilyIds.length === 1) return [activeFamilyIds[0]!];
  if (activeFamilyIds.length === 0) return [];
  throw new Error("Choose at least one family for this question.");
}
