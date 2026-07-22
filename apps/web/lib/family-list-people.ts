/**
 * Family tab List people index (#283 / ADR-0023 amendment).
 *
 * Pure projection at the list-data seam: union of active members, edged (placed) kin, and unplaced
 * members into one browse-only row model with a membership-first badge (Member vs tree-only). No
 * placement or governance fields — those stay on Tree.
 */
import type {
  FamilyMemberView,
  KinListEntry,
  KinRelation,
  PlacedPersonView,
  UnplacedMember,
} from "@chronicle/core";

/** Membership-first badge on List — never Origin / Account / mention jargon. */
export type FamilyListMembershipBadge = "member" | "tree-only";

/** One row in the Family → List searchable people index. */
export interface FamilyListPerson {
  personId: string;
  displayName: string | null;
  identified: boolean;
  lifeStatus: KinListEntry["lifeStatus"];
  /** Member = active Membership; tree-only = kinship/tree presence without active membership. */
  membership: FamilyListMembershipBadge;
  /** Derived relation to the viewer when known; null for self, unplaced, or unrelated members. */
  relation: KinRelation | null;
}

export interface ProjectFamilyListPeopleInput {
  /** Viewer's derived kin (relation chips + life/identity hydration for relatives). */
  kin: readonly KinListEntry[];
  /** Active members with no visible kinship edge (still Members on the index). */
  unplaced: readonly UnplacedMember[];
  /** All active members of the family. */
  members: readonly FamilyMemberView[];
  /** Visible edge endpoints (and seed members when the family has no edges yet). */
  placed: readonly PlacedPersonView[];
}

/**
 * Project the full family people index for List: members ∪ edged kin ∪ unplaced, with
 * Member vs tree-only badges. Stable sort: members first, then tree-only; within each by name/id.
 */
export function projectFamilyListPeople(input: ProjectFamilyListPeopleInput): FamilyListPerson[] {
  const kinById = new Map(input.kin.map((k) => [k.personId, k]));
  const memberIds = new Set(input.members.map((m) => m.personId));

  const ids = new Set<string>();
  for (const m of input.members) ids.add(m.personId);
  for (const u of input.unplaced) ids.add(u.personId);
  for (const p of input.placed) ids.add(p.personId);
  for (const k of input.kin) ids.add(k.personId);

  const memberById = new Map(input.members.map((m) => [m.personId, m]));
  const placedById = new Map(input.placed.map((p) => [p.personId, p]));
  const unplacedById = new Map(input.unplaced.map((u) => [u.personId, u]));

  const rows: FamilyListPerson[] = [];
  for (const personId of ids) {
    const kin = kinById.get(personId);
    const member = memberById.get(personId);
    const placed = placedById.get(personId);
    const unplaced = unplacedById.get(personId);
    const isMember = memberIds.has(personId);

    const displayName =
      kin?.displayName ??
      member?.displayName ??
      unplaced?.displayName ??
      placed?.displayName ??
      null;
    const identified =
      kin?.identified ??
      (member !== undefined || unplaced !== undefined
        ? true
        : displayName !== null && displayName !== "");

    rows.push({
      personId,
      displayName: displayName === "" ? null : displayName,
      identified,
      lifeStatus: kin?.lifeStatus ?? "living",
      membership: isMember ? "member" : "tree-only",
      relation: kin?.relation ?? null,
    });
  }

  rows.sort(
    (a, b) =>
      membershipRank(a.membership) - membershipRank(b.membership) ||
      (a.displayName ?? "").localeCompare(b.displayName ?? "") ||
      (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0),
  );
  return rows;
}

function membershipRank(m: FamilyListMembershipBadge): number {
  return m === "member" ? 0 : 1;
}
