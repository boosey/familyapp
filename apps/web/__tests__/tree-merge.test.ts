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
    sex: over.sex ?? "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
    membership: over.membership ?? "tree-only",
    isSteward: over.isSteward ?? false,
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

it("preserves a seen node's root-relative relation and never adopts the fetch center's relation", () => {
  // Regression (browser-verify 2026-07-12): expanding a boundary caret fetches a subtree resolved
  // with the EXPANDED node as its root, so incoming nodes carry center-relative relations. Letting
  // incoming win relabeled the whole tree relative to the expanded node — the true root's own node
  // read "You" twice, a sibling read "Grandchild", a parent read "Child". Existing nodes must keep
  // the root-relative relation the initial read assigned.
  const existing = [
    node({ personId: "root", relationToRoot: "self" }),
    node({ personId: "gp", relationToRoot: "grandparent", hasHiddenParents: true }),
    node({ personId: "sib", relationToRoot: "sibling" }),
  ];
  // Subtree fetched centered on "gp": root looks like a grandchild, sib a grandchild, gp itself self,
  // plus a genuinely-new great-grandparent "ggp" (beyond the true root's ±2 window).
  const incoming = [
    node({ personId: "gp", relationToRoot: "self", hasHiddenParents: false }),
    node({ personId: "root", relationToRoot: "grandchild" }),
    node({ personId: "sib", relationToRoot: "grandchild" }),
    node({ personId: "ggp", relationToRoot: "parent" }),
  ];
  const merged = mergeNodes(existing, incoming);
  const byId = new Map(merged.map((n) => [n.personId, n]));
  // Seen nodes keep their true-root relation.
  expect(byId.get("root")!.relationToRoot).toBe("self");
  expect(byId.get("gp")!.relationToRoot).toBe("grandparent");
  expect(byId.get("sib")!.relationToRoot).toBe("sibling");
  // But the fresher boundary flag from the deeper read still wins.
  expect(byId.get("gp")!.hasHiddenParents).toBe(false);
  // A genuinely-new node beyond the ±2 window is left unlabeled, never given its center-relative rel.
  expect(byId.get("ggp")!.relationToRoot).toBeNull();
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
