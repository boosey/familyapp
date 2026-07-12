import { expect, it } from "vitest";
import type { ResolvedKinshipEdge, TreeNode } from "@chronicle/core";
import { relabelToRoot } from "@/app/hub/tree/relabel";

const node = (id: string, rel: TreeNode["relationToRoot"] = null): TreeNode => ({
  personId: id,
  displayName: id,
  identified: true,
  lifeStatus: "living",
  birthYear: null,
  deathYear: null,
  relationToRoot: rel,
  hasHiddenParents: false,
  hasHiddenChildren: false,
});
const parentOf = (a: string, b: string): ResolvedKinshipEdge => ({
  edgeType: "parent_of",
  personAId: a,
  personBId: b,
  nature: "biological",
  state: "asserted",
  assertedBy: a,
  assertedAt: new Date(0),
  updatedAt: new Date(0),
});

it("relabels every node's relationToRoot relative to the given root; root is 'self'", () => {
  const nodes = [
    node("gp", "grandparent"),
    node("parent", "parent"),
    node("root", "self"),
    node("kid", "child"),
  ];
  const edges = [parentOf("gp", "parent"), parentOf("parent", "root"), parentOf("root", "kid")];
  const out = relabelToRoot(nodes, edges, "parent");
  const rel = Object.fromEntries(out.map((n) => [n.personId, n.relationToRoot]));
  expect(rel.parent).toBe("self");
  expect(rel.gp).toBe("parent");
  expect(rel.root).toBe("child");
  // From root "parent", the grandchild IS labeled by deriveKin (second-degree down).
  expect(rel.kid).toBe("grandchild");
});

it("gives null to nodes deriveKin cannot reach from the new root", () => {
  const nodes = [node("root", "self"), node("stranger", "cousin")];
  const edges = [parentOf("root", "stranger" /* actually a child */)];
  const out = relabelToRoot(nodes, edges, "isolated-root-not-in-edges");
  const rel = Object.fromEntries(out.map((n) => [n.personId, n.relationToRoot]));
  expect(rel.root).toBe(null);
  expect(rel.stranger).toBe(null);
});
