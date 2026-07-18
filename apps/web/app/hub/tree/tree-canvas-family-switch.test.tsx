// @vitest-environment jsdom
/**
 * Regression test for #141 — the visual tree did not update when switching families on the Family
 * tab's Tree view. TreeCanvas seeded its `nodes`/`edges`/`expansion`/`focus` from props on MOUNT
 * only, so a family switch (which hands the SAME mounted component new `familyId` + `initial` props)
 * left the previous family's tree on screen until a List<->Tree toggle forced a remount.
 *
 * This asserts the fix directly at the canvas: changing `familyId` (with the new family's `initial`
 * data) re-renders the tree with the new family's nodes and drops the old family's nodes.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
import type { FetchSubtreeResult } from "./actions";
import { TreeCanvas } from "./tree-canvas";

afterEach(cleanup);

const noFetch = async (): Promise<FetchSubtreeResult> => ({ ok: false, error: "failed" });

function selfNode(personId: string): TreeNode {
  return {
    personId,
    displayName: personId,
    identified: true,
    lifeStatus: "living",
    birthYear: null,
    deathYear: null,
    relationToRoot: "self",
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: "unknown",
    inviteStatus: "not-applicable",
  };
}

/** A single-person tree for `familyId` focused on `personId` — enough to place exactly one card. */
function soloTree(familyId: string, personId: string): KinshipTreeData {
  return { familyId, rootPersonId: personId, nodes: [selfNode(personId)], edges: [] };
}

it("re-renders the tree when the family changes (familyId + initial) — #141", () => {
  const { rerender } = render(
    <TreeCanvas
      familyId="F1"
      focusPersonId="alice"
      viewerPersonId="alice"
      initial={soloTree("F1", "alice")}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );
  // Family 1's card is drawn.
  expect(screen.getByTestId("tree-node-pos-alice")).toBeTruthy();

  // Switch families: same mounted component, new familyId + new family's tree data.
  rerender(
    <TreeCanvas
      familyId="F2"
      focusPersonId="bob"
      viewerPersonId="alice"
      initial={soloTree("F2", "bob")}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );

  // The new family's card is drawn and the old family's card is gone — no manual List<->Tree toggle.
  expect(screen.getByTestId("tree-node-pos-bob")).toBeTruthy();
  expect(screen.queryByTestId("tree-node-pos-alice")).toBeNull();
});

it("does NOT reset in-session tree state when the SAME family re-renders with new `initial` data", () => {
  const { rerender } = render(
    <TreeCanvas
      familyId="F1"
      focusPersonId="alice"
      viewerPersonId="alice"
      initial={soloTree("F1", "alice")}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );
  expect(screen.getByTestId("tree-node-pos-alice")).toBeTruthy();

  // Same family, but the server hands a fresh `initial` that now ALSO carries a second person. The
  // reset is keyed on a genuine `familyId` change — NOT on `initial` identity/content — so the canvas
  // keeps its mounted in-session node set (the seed only applies at mount + on a real family switch).
  // The newcomer from the fresh `initial` must therefore NOT appear. This is the load-bearing check:
  // if the ref-guard regressed and the effect reset on every render, "carol" would be pulled in.
  const withCarol: KinshipTreeData = {
    familyId: "F1",
    rootPersonId: "alice",
    nodes: [selfNode("alice"), { ...selfNode("carol"), relationToRoot: "child" }],
    edges: [
      {
        edgeType: "parent_of",
        personAId: "alice",
        personBId: "carol",
        nature: "biological",
        state: "asserted",
        assertedBy: "alice",
        assertedAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
  };
  rerender(
    <TreeCanvas
      familyId="F1"
      focusPersonId="alice"
      viewerPersonId="alice"
      initial={withCarol}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );

  expect(screen.getByTestId("tree-node-pos-alice")).toBeTruthy();
  expect(screen.queryByTestId("tree-node-pos-carol")).toBeNull();
});
