/**
 * Pure merge helpers for fetch-on-expand (spec §7). When a boundary caret is tapped, the client
 * fetches a subtree and merges the returned nodes/edges into what it already has, deduping by
 * `personId` and by the normalized edge key `edgeType:personAId:personBId`. Kept pure and separate
 * from TreeCanvas so it is trivially unit-tested without a live DB.
 */
import type { ResolvedKinshipEdge, TreeNode } from "@chronicle/core";

/** Normalized edge key — matches the layout module's key so dedup is consistent across the app. */
export function edgeKey(e: ResolvedKinshipEdge): string {
  return `${e.edgeType}:${e.personAId}:${e.personBId}`;
}

/**
 * Merge incoming nodes into `existing`, deduping by `personId`. Incoming nodes WIN on conflict for
 * their boundary flags + identity fields — a re-fetch centered on a boundary person carries fresher
 * boundary flags (a node that was a boundary in the first read may now have its kin materialized,
 * flipping `hasHidden*` to false).
 *
 * EXCEPTION — `relationToRoot`. A boundary fetch is resolved with the EXPANDED node as its root, so
 * the incoming nodes carry a relation computed relative to THAT center, not the tree's true root. If
 * incoming won here too, expanding a grandparent's parents would relabel the whole tree relative to
 * the grandparent (the root's own node would read "You" a second time, a sibling would read
 * "Grandchild", etc.). So we PRESERVE the root-relative `relationToRoot` the initial (true-root) read
 * already assigned to a node we've seen before. A genuinely NEW node revealed by the fetch is, by
 * construction, beyond the ±2-generation window from the true root — hence beyond `deriveKin`'s
 * second-degree coverage — so it has no expressible relation to the true root and is left `null`
 * (shown without a relation label) rather than mislabeled with its center-relative relation.
 */
export function mergeNodes(existing: readonly TreeNode[], incoming: readonly TreeNode[]): TreeNode[] {
  const prevById = new Map<string, TreeNode>(existing.map((n) => [n.personId, n]));
  const byId = new Map<string, TreeNode>();
  for (const n of existing) byId.set(n.personId, n);
  for (const n of incoming) {
    const prev = prevById.get(n.personId);
    byId.set(n.personId, {
      ...n,
      relationToRoot: prev ? prev.relationToRoot : null,
    });
  }
  return [...byId.values()];
}

/** Merge incoming edges into `existing`, deduping by normalized edge key. Incoming win on conflict. */
export function mergeEdges(
  existing: readonly ResolvedKinshipEdge[],
  incoming: readonly ResolvedKinshipEdge[],
): ResolvedKinshipEdge[] {
  const byKey = new Map<string, ResolvedKinshipEdge>();
  for (const e of existing) byKey.set(edgeKey(e), e);
  for (const e of incoming) byKey.set(edgeKey(e), e);
  return [...byKey.values()];
}
