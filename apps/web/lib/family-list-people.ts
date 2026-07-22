/**
 * Family tab List people index (#283 / ADR-0023 amendment).
 *
 * Pure projection at the list-data seam: union of active members, edged (placed) kin, and unplaced
 * members into one browse-only row model with a membership-first badge (Member vs tree-only). No
 * placement or governance fields — those stay on Tree.
 *
 * #337 — `reconcileSide` is hydrated server-side (origin + accountId) so List + Tree can gate steward
 * Reconciliation ("This is the same person as…") without a second client round-trip.
 */
import type {
  FamilyMemberView,
  KinListEntry,
  KinRelation,
  PersonSex,
  PlacedPersonView,
  TreeNode,
  UnplacedMember,
} from "@chronicle/core";
import type { PersonOrigin } from "@chronicle/db";
import {
  reconcileSideOf,
  type ReconcilePersonView,
  type ReconcileSide,
} from "./reconcile-eligibility";

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
  /**
   * #330 fix — REAL identity fields (never invented) so `resolveListPersonNode` can synthesize an
   * accurate `TreeNode` for people outside the current tree window. `projectFamilyListPeople` itself
   * has no identity source, so it always leaves these null/"unknown"; the loader
   * (`loadFamilyTabData`) hydrates them from `persons` via `hydrateFamilyListPeopleIdentity` below.
   * Without this, Edit→Save from List could silently wipe a real birth year / sex (it always writes
   * whatever the sheet was seeded with).
   */
  birthYear: number | null;
  deathYear: number | null;
  sex: PersonSex;
  /**
   * #334 fix — the person's REAL `inviteStatus` (never invented), so `resolveListPersonNode` can
   * synthesize an accurate `TreeNode` for people outside the current tree window and List's Invite
   * button/pending note show for them too. `projectFamilyListPeople` itself has no invite-status
   * source, so it always leaves this `"not-applicable"`; the loader (`loadFamilyTabData`) hydrates the
   * real value from `@chronicle/core`'s `resolveInviteStatuses` (the same ADR-0028/#332 batch rule
   * `resolveKinshipTree` applies) via `hydrateFamilyListPeopleIdentity` below.
   */
  inviteStatus: TreeNode["inviteStatus"];
  /**
   * #337 — which reconcile side this person can occupy in the selected family, or null when neither
   * (placeholder, account-less member, non-member non-mention). Projector leaves null; loader hydrates
   * from origin + accountId.
   */
  reconcileSide: ReconcileSide | null;
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
      // No identity/invite/reconcile source in this pure projector — the loader hydrates these via
      // `hydrateFamilyListPeopleIdentity` (below) so List's Edit/Save never wipes real data (#330),
      // List's Invite affordance reflects the person's REAL status (#334), and #337 reconcile gating
      // has origin/account without a client round-trip.
      birthYear: null,
      deathYear: null,
      sex: "unknown",
      inviteStatus: "not-applicable",
      reconcileSide: null,
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

/** Real identity fields sourced from `persons` — see {@link hydrateFamilyListPeopleIdentity}. */
export interface FamilyListPersonIdentity {
  lifeStatus: KinListEntry["lifeStatus"];
  birthYear: number | null;
  deathYear: number | null;
  sex: PersonSex;
  /** #334 fix — the person's real `inviteStatus`, resolved by `@chronicle/core`'s `resolveInviteStatuses`. */
  inviteStatus: TreeNode["inviteStatus"];
  /** #337 — `persons.origin` for reconcile eligibility. */
  origin: PersonOrigin;
  /** #337 — `persons.accountId` for member-with-account eligibility. */
  accountId: string | null;
}

/**
 * #330/#334/#337 fix — merge real identity + inviteStatus + reconcileSide onto `FamilyListPerson`
 * rows after projection. Kept separate from `projectFamilyListPeople` so that pure projector's inputs
 * don't balloon; `loadFamilyTabData` calls this once, after projecting, with identity loaded from
 * `persons` (+ invite status from `resolveInviteStatuses`) for the projected ids. A person with no
 * entry in `identityById` keeps the projector's safe defaults rather than crashing.
 */
export function hydrateFamilyListPeopleIdentity(
  people: readonly FamilyListPerson[],
  identityById: ReadonlyMap<string, FamilyListPersonIdentity>,
): FamilyListPerson[] {
  return people.map((p) => {
    const identity = identityById.get(p.personId);
    if (!identity) return p;
    const reconcileSide = reconcileSideOf({
      personId: p.personId,
      displayName: p.displayName,
      identified: p.identified,
      isActiveMember: p.membership === "member",
      hasAccount: identity.accountId !== null,
      isMention: identity.origin === "mention",
    });
    return {
      ...p,
      lifeStatus: identity.lifeStatus,
      birthYear: identity.birthYear,
      deathYear: identity.deathYear,
      sex: identity.sex,
      inviteStatus: identity.inviteStatus,
      reconcileSide,
    };
  });
}

/** Convert a List row into the reconcile eligibility view (for candidate pickers). */
export function asReconcilePerson(p: FamilyListPerson): ReconcilePersonView {
  return {
    personId: p.personId,
    displayName: p.displayName,
    identified: p.identified,
    isActiveMember: p.membership === "member",
    // Reconstruct flags from reconcileSide so callers don't need raw origin/account.
    hasAccount: p.reconcileSide === "member",
    isMention: p.reconcileSide === "mention",
  };
}

/**
 * #330/#334 — resolve a `TreeNode` for a List row so List can open the SAME `PersonDetails` sheet Tree
 * uses. A List row's person is often already materialized in the viewer's current tree window
 * (`treeNodes`) — prefer that node so dates/sex/hidden-edge flags (and its own `inviteStatus`) are
 * accurate. When it is NOT (e.g. a tree-only relative outside the rendered window, or an unplaced
 * member never placed on Tree), synthesize a minimal node from the `FamilyListPerson` projection:
 * birth/death year, sex, and `inviteStatus` all come from the loader-hydrated fields (real values —
 * see {@link hydrateFamilyListPeopleIdentity} — NEVER invented; a prior version defaulted birth/death/
 * sex to null/"unknown" here, which let List's Edit→Save silently wipe a real DOB/sex, #330, and
 * separately hardcoded `inviteStatus: "not-applicable"`, which hid List's Invite affordance for every
 * synthesized row regardless of the person's real status, #334). Hidden-edge flags default to false —
 * List has no edge-window concept.
 */
export function resolveListPersonNode(
  person: FamilyListPerson,
  treeNodes: readonly TreeNode[],
): TreeNode {
  const existing = treeNodes.find((n) => n.personId === person.personId);
  if (existing) return existing;
  return {
    personId: person.personId,
    displayName: person.displayName,
    identified: person.identified,
    lifeStatus: person.lifeStatus,
    birthYear: person.birthYear,
    deathYear: person.deathYear,
    sex: person.sex,
    relationToRoot: person.relation,
    hasHiddenParents: false,
    hasHiddenChildren: false,
    inviteStatus: person.inviteStatus,
  };
}
