/**
 * Server-side guard for an invitation's single-family target (feat/family-scope-selector review,
 * Finding 2). An invitation belongs to exactly one family. The Invite tab's client `<select>` forces
 * an explicit choice — a disabled placeholder is prepended when the inviter belongs to >1 family, so
 * the browser can't silently auto-select the first (arbitrary) family — but a crafted POST can still
 * omit `familyId`. This pure resolver is the backstop, mirroring `resolveComposeFamilies` for the Ask
 * compose surface: it decides which family id reaches the write path, or refuses.
 *
 * Membership in the chosen family is NOT re-checked here — createInvitation / createLinkSession own
 * that gate transactionally. This only settles the AMBIGUITY: an inviter in several families must pick
 * one deliberately; an inviter in exactly one can only ever mean that one.
 */
export function resolveInviteFamilyId(familyId: string, activeFamilyIds: string[]): string {
  const chosen = familyId.trim();
  // A deliberate pick of a family the inviter is actually in — the normal path.
  if (chosen && activeFamilyIds.includes(chosen)) return chosen;
  // Empty (or a bogus non-member id) collapses to the lone family when there is exactly one — the
  // only family they could possibly invite into, so it is unambiguous and safe.
  if (activeFamilyIds.length === 1) return activeFamilyIds[0]!;
  // Empty/ambiguous with several (or zero) families → refuse rather than invite into an arbitrary one.
  throw new Error("Choose a family for this invitation.");
}
