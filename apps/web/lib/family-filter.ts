/**
 * Family filter — the shared `?families=` browse param (ADR-0021).
 *
 * Replaces the single-select `?scope=` hub selector. The filter narrows WHAT IS DISPLAYED across the
 * browse surfaces (album, stories, tree); it never grants access nor targets a write. Absent = all,
 * an explicit `none` sentinel = the empty set, else a comma list of the viewer's OWN active family ids
 * (unknown/crafted ids are dropped — a client-submitted filter is never trusted).
 *
 * These are pure helpers so the server derivation, the client chip widget, and the still-single tabs
 * (which derive a single scope via `deriveSingleScope`) all agree and are unit-testable without a
 * request.
 */

/** The browse URL param name — one place so producers and consumers can't drift. */
export const FAMILIES_PARAM = "families";
/** The explicit empty-set sentinel (chip bar with every chip OFF). Distinct from absent (= all). */
export const FAMILIES_NONE = "none";

export type FamilyFilter =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "some"; ids: string[] };

/**
 * Parse the raw `?families=` value against the viewer's active family ids.
 *   - undefined or "" (absent)            → { kind: "all" }
 *   - "none" (the FAMILIES_NONE sentinel) → { kind: "none" }
 *   - a string[] (Next repeated param)    → joined with "," then the csv rules below
 *   - a csv string → split on ",", trim, drop empties, keep only ids ∈ activeFamilyIds, dedup,
 *     preserve activeFamilyIds order. Then:
 *       * kept list empty (all unknown/crafted) → { kind: "all" }  (never-trust fallback)
 *       * kept list == the full active set      → { kind: "all" }  (canonical)
 *       * else                                  → { kind: "some", ids }
 */
export function parseFamilyFilter(
  raw: string | string[] | undefined,
  activeFamilyIds: string[],
): FamilyFilter {
  // Normalize a repeated param to a single csv string; absent → all.
  const joined = Array.isArray(raw) ? raw.join(",") : raw;
  if (joined === undefined || joined === "") return { kind: "all" };
  if (joined === FAMILIES_NONE) return { kind: "none" };

  // Restrict to the viewer's OWN active families, deduped, in active-set order (a crafted/unknown id
  // is simply absent from the result — never trusted).
  const requested = new Set(
    joined
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  const kept = activeFamilyIds.filter((id) => requested.has(id));

  // Empty (all unknown) or the full active set → canonical "all".
  if (kept.length === 0) return { kind: "all" };
  if (kept.length === activeFamilyIds.length) return { kind: "all" };
  return { kind: "some", ids: kept };
}

/**
 * Collapse a filter to the legacy single "scope" value ("all" | familyId) for the tabs that are not
 * yet multi-aware (ask/asks/invite/requests/tree/stories).
 *   all → "all";  none → "all";  some → ids[0]
 */
export function deriveSingleScope(filter: FamilyFilter): string {
  if (filter.kind === "some") return filter.ids[0]!;
  return "all";
}

/**
 * The concrete selected-id list the album (and any multi-select surface) shows.
 *   all → [...activeFamilyIds];  none → [];  some → ids
 */
export function selectedIdList(filter: FamilyFilter, activeFamilyIds: string[]): string[] {
  if (filter.kind === "all") return [...activeFamilyIds];
  if (filter.kind === "none") return [];
  return filter.ids;
}

/**
 * Serialize a NEW selection back to a `?families=` value, or null when the param should be OMITTED.
 *   selected.length === activeFamilyIds.length → null (omit = absent = all)
 *   selected.length === 0                      → FAMILIES_NONE
 *   else                                       → selected.join(",")
 * `selected` is assumed already restricted to active ids.
 */
export function serializeSelection(
  selectedIds: string[],
  activeFamilyIds: string[],
): string | null {
  if (selectedIds.length === activeFamilyIds.length) return null;
  if (selectedIds.length === 0) return FAMILIES_NONE;
  return selectedIds.join(",");
}
