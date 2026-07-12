// `deriveKin` is imported from the dependency-free subpath so this client-reachable module
// (via tree-canvas.tsx) does not pull the server-only `@chronicle/core` barrel (node:crypto) into
// the browser bundle. `ResolvedKinshipEdge`/`TreeNode` stay type-only imports (erased at build).
import { deriveKin, type KinRelation } from "@chronicle/core/kinship-derive";
import type { ResolvedKinshipEdge, TreeNode } from "@chronicle/core";

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
