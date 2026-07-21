/**
 * Name match for add-relative vs unplaced members (#251).
 *
 * When the tree's Add partner/relative flow types a name that already belongs to an unplaced
 * family member, we offer to `linkExistingMember` instead of minting a duplicate. Matching is
 * exact after normalize (trim → collapse whitespace → lower-case) — offer-never-silent; the form
 * still asks the user before linking.
 */

export function normalizeDisplayName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface UnplacedNameCandidate {
  personId: string;
  displayName: string | null;
}

/**
 * Return unplaced members whose displayName equals `typedName` after normalize. Empty typed names
 * never match (anonymous mint stays on the create path). `excludePersonIds` drops the add anchor
 * (and any other ids that must not be offered as the relative being added).
 */
export function matchUnplacedByDisplayName(
  typedName: string,
  unplaced: readonly UnplacedNameCandidate[],
  excludePersonIds: ReadonlySet<string> | readonly string[] = [],
): UnplacedNameCandidate[] {
  const needle = normalizeDisplayName(typedName);
  if (!needle) return [];
  const exclude =
    excludePersonIds instanceof Set ? excludePersonIds : new Set(excludePersonIds);
  return unplaced.filter((m) => {
    if (exclude.has(m.personId)) return false;
    if (!m.displayName) return false;
    return normalizeDisplayName(m.displayName) === needle;
  });
}
