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
 * Merge incoming nodes into `existing`, deduping by `personId`. Incoming nodes WIN on conflict — a
 * re-fetch centered on a boundary person carries fresher boundary flags (a node that was a boundary in
 * the first read may now have its kin materialized, flipping `hasHidden*` to false).
 */
export function mergeNodes(existing: readonly TreeNode[], incoming: readonly TreeNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const n of existing) byId.set(n.personId, n);
  for (const n of incoming) byId.set(n.personId, n);
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
