import { deriveKin, type KinRelation, type ResolvedKinshipEdge, type TreeNode } from "@chronicle/core";

/**
 * Return `nodes` with each `relationToRoot` recomputed relative to `rootPersonId` from `edges`. The
 * root is "self"; anyone deriveKin can label gets that relation; everyone else gets null (rather than
 * a stale or wrong-root relation). Pure — no DB, no auth (edges are already the resolved projection).
 */
export function relabelToRoot(
  nodes: readonly TreeNode[],
  edges: readonly ResolvedKinshipEdge[],
  rootPersonId: string,
): TreeNode[] {
  const rel = new Map<string, KinRelation>(
    deriveKin([...edges], rootPersonId).map((k) => [k.personId, k.relation]),
  );
  return nodes.map((n) => ({
    ...n,
    relationToRoot: n.personId === rootPersonId ? "self" : (rel.get(n.personId) ?? null),
  }));
}
