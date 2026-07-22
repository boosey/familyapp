/**
 * Person-bound Invite modal (#334, ADR-0028) — pure family-target resolution.
 *
 * The modal's family designator must never offer a Family the invitee already holds an ACTIVE
 * membership in (there's nothing to invite them into there), and should auto-seed the ONE remaining
 * eligible Family so a single-family case never makes the inviter pick — mirroring
 * `seedDesignatorFamily`'s single-unambiguous-option rule, but computed against the INVITEE's
 * membership gap rather than the browse filter. Kept pure (no DB) so it is unit-testable in isolation;
 * the server action (`listPersonBoundInviteTargetsAction`) supplies the two id sets from the DB.
 */
export interface PersonInviteFamilyOption {
  id: string;
  name: string;
  shortName?: string | null;
}

export interface PersonInviteFamilyTargets {
  /** The viewer's active families MINUS any where the invitee already holds an active membership. */
  families: PersonInviteFamilyOption[];
  /** The lone eligible family when exactly one remains — auto-selected; otherwise null (no seed). */
  seededFamilyId: string | null;
}

/**
 * `viewerFamilies` — ALL of the viewer's active families (the designator's full candidate set).
 * `inviteeActiveFamilyIds` — the families the invitee ALREADY holds an active membership in (any of
 * them, not just the currently-browsed one — inviting into a family they're already in is a no-op).
 */
export function resolvePersonInviteFamilies(
  viewerFamilies: readonly PersonInviteFamilyOption[],
  inviteeActiveFamilyIds: readonly string[],
): PersonInviteFamilyTargets {
  const alreadyIn = new Set(inviteeActiveFamilyIds);
  const families = viewerFamilies.filter((f) => !alreadyIn.has(f.id));
  const seededFamilyId = families.length === 1 ? families[0]!.id : null;
  return { families, seededFamilyId };
}
