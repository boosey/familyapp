/**
 * Family-tab data loader (2026-07-14). The visual family tree became an in-hub tab (`?tab=family`)
 * instead of a standalone `/hub/tree` route, and the `/hub/kin` relatives page was folded into the
 * tab's List view. This helper resolves BOTH surfaces' data in one place for the hub server component:
 *   - the focus-rooted kinship tree (`resolveKinshipTree`, rooted on `?anchor=` when valid, else the
 *     viewer) for the Tree view, and
 *   - the viewer's derived kin (`listMyKin`) for the List view.
 *
 * All reads go through the audited kinship front door; a forged/foreign `?anchor=` never materializes
 * (core's root guard returns an empty projection, so it fails the "focus is a real node" check and we
 * fall back to the viewer's self-root — same rule the old /hub/tree page used).
 */
import {
  listMyKin,
  resolveKinshipTree,
  AuthorizationError,
  type AuthContext,
  type KinListEntry,
  type KinshipTreeData,
} from "@chronicle/core";
import type { Database } from "@chronicle/db";

export interface FamilyTabData {
  familyId: string;
  /** The FIXED focus person for the tree (anchor when valid, else the viewer). */
  focusPersonId: string;
  tree: KinshipTreeData;
  kin: KinListEntry[];
}

/**
 * Load the Family tab's tree + relatives for `familyId` (already validated against the viewer's own
 * active families by the caller). `focusParam` is the untrusted `?anchor=`/`?root=` deep-link. Returns
 * null when even the viewer's own self-root yields no tree (treated as the no-data empty state).
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

  const kin = await listMyKin(db, ctx, familyId);
  return { familyId, focusPersonId, tree, kin };
}
