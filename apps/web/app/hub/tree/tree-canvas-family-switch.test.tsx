// @vitest-environment jsdom
/**
 * Regression tests for how <TreeCanvas> reconciles its `initial` prop after mount.
 *
 * #141 — the visual tree did not update when SWITCHING families on the Family tab's Tree view.
 * TreeCanvas seeds its `nodes`/`edges`/`expansion`/`focus` from props on MOUNT only, so a family
 * switch (which hands the SAME mounted component new `familyId` + `initial` props) left the previous
 * family's tree on screen until a List<->Tree toggle forced a remount. Fix: a family change fully
 * RESETS from the new props (first test below).
 *
 * #161 follow-up — the SAME-family case. When a mutation (place an unplaced member, add a relative,
 * edit a person) revalidates `/hub` and `router.refresh()` hands a fresh `initial` for the SAME family,
 * TreeCanvas must reflect it WITHOUT a manual reload. The original #141 fix over-corrected by making a
 * same-family re-render fully inert (to protect in-session expansion/focus/camera) — which also swallowed
 * genuine new server data. The fix MERGES the fresh `initial` into current state (additive + incoming-
 * wins), so new/edited nodes appear while in-session expansion (a superset of the bounded `initial`
 * window) is preserved. These three tests pin that: additive shows, preserved survives, edits reflect.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { KinshipTreeData, ResolvedKinshipEdge, TreeNode } from "@chronicle/core";
import type { FetchSubtreeResult } from "./actions";
import { TreeCanvas } from "./tree-canvas";

afterEach(cleanup);

const noFetch = async (): Promise<FetchSubtreeResult> => ({ ok: false, error: "failed" });

function selfNode(personId: string, displayName = personId): TreeNode {
  return {
    personId,
    displayName,
    identified: true,
    lifeStatus: "living",
    birthYear: null,
    deathYear: null,
    relationToRoot: "self",
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: "unknown",
    inviteStatus: "not-applicable",
    membership: "tree-only",
    isSteward: false,
  };
}

/** A `parent_of` edge from `parent` to `child`, enough to connect a second card. */
function parentEdge(parent: string, child: string): ResolvedKinshipEdge {
  return {
    edgeType: "parent_of",
    personAId: parent,
    personBId: child,
    nature: "biological",
    state: "asserted",
    assertedBy: parent,
    assertedAt: new Date(0),
    updatedAt: new Date(0),
  };
}

/** A single-person tree for `familyId` focused on `personId` — enough to place exactly one card. */
function soloTree(familyId: string, personId: string): KinshipTreeData {
  return { familyId, rootPersonId: personId, nodes: [selfNode(personId)], edges: [] };
}

/** A two-person (parent → child) tree for `familyId`. */
function pairTree(familyId: string, parent: string, child: string): KinshipTreeData {
  return {
    familyId,
    rootPersonId: parent,
    nodes: [selfNode(parent), { ...selfNode(child), relationToRoot: "child" }],
    edges: [parentEdge(parent, child)],
  };
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

it("merges NEW server data into the tree on a SAME-family refresh (the placement bug) — #161", () => {
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
  expect(screen.queryByTestId("tree-node-pos-carol")).toBeNull();

  // A member is placed → the action revalidates /hub and router.refresh() hands a fresh `initial`
  // for the SAME family that now also carries carol (connected to alice). She must appear WITHOUT a
  // manual reload — this is the reported bug ("force update shows it there").
  rerender(
    <TreeCanvas
      familyId="F1"
      focusPersonId="alice"
      viewerPersonId="alice"
      initial={pairTree("F1", "alice", "carol")}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );

  expect(screen.getByTestId("tree-node-pos-alice")).toBeTruthy();
  expect(screen.getByTestId("tree-node-pos-carol")).toBeTruthy();
});

it("preserves in-session nodes absent from the refreshed `initial` (merge never prunes) — #141/#161", () => {
  // Mount with two people loaded (carol reached via expansion/top-up in real use).
  const { rerender } = render(
    <TreeCanvas
      familyId="F1"
      focusPersonId="alice"
      viewerPersonId="alice"
      initial={pairTree("F1", "alice", "carol")}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );
  expect(screen.getByTestId("tree-node-pos-carol")).toBeTruthy();

  // A refresh hands a fresh `initial` whose bounded window happens to NOT include carol (she's beyond
  // it). The merge must not drop her — in-session state is a superset of the bounded read. If the fix
  // regressed to a full reset-on-refresh, carol would vanish (the #141 hazard).
  rerender(
    <TreeCanvas
      familyId="F1"
      focusPersonId="alice"
      viewerPersonId="alice"
      initial={soloTree("F1", "alice")}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );

  expect(screen.getByTestId("tree-node-pos-alice")).toBeTruthy();
  expect(screen.getByTestId("tree-node-pos-carol")).toBeTruthy();
});

it("is a no-op when a same-family refresh hands new-identity but identical-content `initial` — #161", () => {
  // The signature gate's whole reason for existing: `initial` gets a new object identity every render,
  // so an ungated merge (mergeNodes returns a fresh array each call) would loop setState forever. Here
  // we re-render repeatedly with FRESH `initial` objects carrying IDENTICAL content. If the gate
  // regressed, React would throw "Maximum update depth exceeded"; the tree must simply stay put.
  const { rerender } = render(
    <TreeCanvas
      familyId="F1"
      focusPersonId="alice"
      viewerPersonId="alice"
      initial={pairTree("F1", "alice", "carol")}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );
  for (let i = 0; i < 3; i++) {
    rerender(
      <TreeCanvas
        familyId="F1"
        focusPersonId="alice"
        viewerPersonId="alice"
        // Fresh object, same content — the merge branch must recognize it as unchanged and do nothing.
        initial={pairTree("F1", "alice", "carol")}
        fetchSubtree={vi.fn(noFetch)}
      />,
    );
  }
  // Exactly one of each card — no duplication, no crash, no loop.
  expect(screen.getAllByTestId("tree-node-pos-alice")).toHaveLength(1);
  expect(screen.getAllByTestId("tree-node-pos-carol")).toHaveLength(1);
});

it("reflects an edited node's name on a SAME-family refresh — #161", () => {
  const { rerender } = render(
    <TreeCanvas
      familyId="F1"
      focusPersonId="alice"
      viewerPersonId="alice"
      initial={{ familyId: "F1", rootPersonId: "alice", nodes: [selfNode("alice", "Alice")], edges: [] }}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );
  expect(screen.getByText("Alice")).toBeTruthy();

  // Editing alice's name revalidates /hub; the fresh same-family `initial` carries the new name.
  rerender(
    <TreeCanvas
      familyId="F1"
      focusPersonId="alice"
      viewerPersonId="alice"
      initial={{ familyId: "F1", rootPersonId: "alice", nodes: [selfNode("alice", "Alicia")], edges: [] }}
      fetchSubtree={vi.fn(noFetch)}
    />,
  );

  expect(screen.getByText("Alicia")).toBeTruthy();
  expect(screen.queryByText("Alice")).toBeNull();
});
