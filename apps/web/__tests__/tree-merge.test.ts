/**
 * Fetch-on-expand merge helpers (spec §7): merging a fetched subtree must dedup nodes by personId and
 * edges by the normalized `edgeType:personAId:personBId` key, with incoming winning on conflict (a
 * re-centered read carries fresher boundary flags).
 */
import { expect, it } from "vitest";
import type { ResolvedKinshipEdge, TreeNode } from "@chronicle/core";
import { edgeKey, mergeEdges, mergeNodes } from "@/app/hub/tree/merge";

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? "X",
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    birthYear: over.birthYear ?? null,
    deathYear: over.deathYear ?? null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: over.hasHiddenParents ?? false,
    hasHiddenChildren: over.hasHiddenChildren ?? false,
  };
}

function edge(a: string, b: string, type: ResolvedKinshipEdge["edgeType"] = "parent_of"): ResolvedKinshipEdge {
  return {
    edgeType: type,
    personAId: a,
    personBId: b,
    nature: type === "parent_of" ? "biological" : null,
    state: "asserted",
    assertedBy: a,
    assertedAt: new Date(0),
    updatedAt: new Date(0),
  } as ResolvedKinshipEdge;
}

it("merges nodes without duplicates, incoming winning on conflict", () => {
  const existing = [node({ personId: "a", hasHiddenParents: true }), node({ personId: "b" })];
  const incoming = [
    node({ personId: "a", hasHiddenParents: false }), // boundary flag flipped by the deeper read
    node({ personId: "c" }),
  ];
  const merged = mergeNodes(existing, incoming);
  expect(merged.map((n) => n.personId).sort()).toEqual(["a", "b", "c"]);
  expect(merged.find((n) => n.personId === "a")!.hasHiddenParents).toBe(false);
});

it("merges edges deduping by normalized edge key", () => {
  const existing = [edge("a", "b"), edge("b", "c")];
  const incoming = [edge("a", "b"), edge("c", "d"), edge("c", "e", "partnered_with")];
  const merged = mergeEdges(existing, incoming);
  const keys = merged.map(edgeKey).sort();
  expect(keys).toEqual([
    "parent_of:a:b",
    "parent_of:b:c",
    "parent_of:c:d",
    "partnered_with:c:e",
  ]);
});
