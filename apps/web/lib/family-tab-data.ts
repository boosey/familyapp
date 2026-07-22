/**
 * Family-tab data loader (2026-07-14). The visual family tree became an in-hub tab (`?tab=family`)
 * instead of a standalone `/hub/tree` route, and the `/hub/kin` relatives page was folded into the
 * tab's List view. This helper resolves BOTH surfaces' data in one place for the hub server component:
 *   - the focus-rooted kinship tree (`resolveKinshipTree`, rooted on `?anchor=` when valid, else the
 *     viewer) for the Tree view, and
 *   - the browse-only people index (#283) for the List view.
 *
 * All reads go through the audited kinship front door; a forged/foreign `?anchor=` never materializes
 * (core's root guard returns an empty projection, so it fails the "focus is a real node" check and we
 * fall back to the viewer's self-root — same rule the old /hub/tree page used).
 */
import {
  listMyKin,
  listUnplacedMembers,
  listFamiliesStewardedBy,
  listGovernableKinEdges,
  listMembersOfFamily,
  listPlacedPersons,
  resolveKinshipTree,
  resolveInviteStatuses,
  AuthorizationError,
  type AuthContext,
  type GovernableKinEdge,
  type KinshipTreeData,
  type TreeNode,
  type UnplacedMember,
} from "@chronicle/core";
import { inArray } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import {
  hydrateFamilyListPeopleIdentity,
  projectFamilyListPeople,
  type FamilyListPerson,
  type FamilyListPersonIdentity,
} from "./family-list-people";

export interface FamilyTabData {
  familyId: string;
  /** The FIXED focus person for the tree (anchor when valid, else the viewer). */
  focusPersonId: string;
  tree: KinshipTreeData;
  /**
   * #283 — browse-only people index for List: members ∪ edged tree-only kin ∪ unplaced members,
   * with Member vs tree-only badges. Projection lives in `family-list-people.ts`.
   */
  listPeople: FamilyListPerson[];
  /**
   * #161/ADR-0023 — active members of this family placed in NO visible kinship edge (and not curated
   * "non-family"). Invisible in the graph-only tree; surfaced on Tree (tray) — not on List (#283).
   */
  unplaced: UnplacedMember[];
  /**
   * Whether the viewer is this family's STEWARD — gates the destructive "remove member" affordance in
   * the Tree unplaced surface (computed server-side so the button never flashes). The write path re-checks.
   */
  viewerIsSteward: boolean;
  /**
   * #254 — family's currently-visible edges with per-edge capability flags (steward Remove / subject
   * Hide). Loaded for Tree governance (PersonDetails); List no longer hosts governable edges (#283).
   */
  governableEdges: GovernableKinEdge[];
}

/**
 * Load the Family tab's tree + List people index for `familyId` (already validated against the
 * viewer's own active families by the caller). `focusParam` is the untrusted `?anchor=`/`?root=`
 * deep-link. Returns null when even the viewer's own self-root yields no tree (treated as the
 * no-data empty state).
 */
export async function loadFamilyTabData(
  db: Database,
  ctx: AuthContext,
  familyId: string,
  focusParam: string | undefined,
): Promise<FamilyTabData | null> {
  if (ctx.kind !== "account") return null;
  const viewerId = ctx.personId;

  const loadTree = async (rootPersonId: string): Promise<KinshipTreeData | null> => {
    try {
      return await resolveKinshipTree(db, ctx, familyId, rootPersonId);
    } catch (err) {
      if (err instanceof AuthorizationError) throw err;
      return null;
    }
  };

  // Try the requested focus first (rooted on it); honor it only if it materialized as a real node in
  // its own projection. Otherwise fall back to the viewer's self-root.
  let focusPersonId = viewerId;
  let tree: KinshipTreeData | null = null;
  if (focusParam && focusParam !== viewerId) {
    const requested = await loadTree(focusParam);
    if (requested && requested.nodes.some((n) => n.personId === focusParam)) {
      focusPersonId = focusParam;
      tree = requested;
    }
  }
  if (!tree) {
    focusPersonId = viewerId;
    tree = await loadTree(viewerId);
  }
  if (!tree) return null;

  const [kin, unplaced, stewarded, governableEdges, members, placed] = await Promise.all([
    listMyKin(db, ctx, familyId),
    listUnplacedMembers(db, ctx, familyId),
    listFamiliesStewardedBy(db, ctx.personId),
    listGovernableKinEdges(db, ctx, familyId),
    listMembersOfFamily(db, familyId),
    listPlacedPersons(db, ctx, familyId),
  ]);
  const viewerIsSteward = stewarded.some((f) => f.familyId === familyId);
  const projected = projectFamilyListPeople({ kin, unplaced, members, placed });

  // #330/#334 fix — hydrate REAL lifeStatus/birthYear/deathYear/sex/inviteStatus from `persons` (+ the
  // shared `resolveInviteStatuses` batch, ADR-0028/#332) for every projected id, so
  // `resolveListPersonNode` never has to synthesize a null/"unknown"/"living"/"not-applicable"
  // placeholder for a person outside the current tree window (List's projector itself has no identity
  // or invite-status source).
  const identityRows =
    projected.length > 0
      ? await db
          .select({
            id: persons.id,
            lifeStatus: persons.lifeStatus,
            birthYear: persons.birthYear,
            deathYear: persons.deathYear,
            sex: persons.sex,
            identified: persons.identified,
          })
          .from(persons)
          .where(inArray(persons.id, projected.map((p) => p.personId)))
      : [];
  // #334 — same batch invite-status rule `resolveKinshipTree` applies to its window, scoped to THIS
  // (browsed) family for pending-invite purposes and to the viewer's WHOLE active-family set for the
  // membership-gap check (see `resolveInviteStatuses`'s doc comment).
  const inviteStatusById =
    identityRows.length > 0
      ? await resolveInviteStatuses(
          db,
          viewerId,
          familyId,
          identityRows.map((r) => ({
            personId: r.id,
            identified: r.identified,
            lifeStatus: r.lifeStatus,
          })),
        )
      : new Map<string, TreeNode["inviteStatus"]>();
  const identityById = new Map<string, FamilyListPersonIdentity>(
    identityRows.map((r) => [
      r.id,
      {
        lifeStatus: r.lifeStatus,
        birthYear: r.birthYear,
        deathYear: r.deathYear,
        sex: r.sex ?? "unknown",
        inviteStatus: inviteStatusById.get(r.id) ?? "not-applicable",
      },
    ]),
  );
  const listPeople = hydrateFamilyListPeopleIdentity(projected, identityById);
  return { familyId, focusPersonId, tree, listPeople, unplaced, viewerIsSteward, governableEdges };
}
