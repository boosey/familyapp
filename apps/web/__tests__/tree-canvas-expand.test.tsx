// @vitest-environment jsdom
/**
 * TreeCanvas interaction (spec §7):
 *   - first tap on a node SELECTS it (opens the read-only panel) without any fetch;
 *   - a second tap on the SAME selected node RE-ROOTS the tree there (client-side fetch + relabel);
 *   - a drag (pointer moved beyond the tap threshold) is NOT a tap and never selects;
 *   - tapping a BOUNDARY ancestor caret (parents not loaded) fetches that subtree, merges without
 *     dupes, and reveals the new node;
 *   - a fetch failure surfaces the load error and leaves the tree unchanged.
 *
 * A "tap" is a pointerdown + pointerup at (nearly) the same point on the same node. The server action
 * is mocked (no live DB). We feed the real pure layout tiny fixtures.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
import { TreeCanvas } from "@/app/hub/tree/tree-canvas";
import type { FetchSubtreeResult } from "@/app/hub/tree/actions";

afterEach(cleanup);

/** Simulate a real tap: pointerdown then pointerup at the same point on the node card. */
async function tap(el: Element, at: { x: number; y: number } = { x: 5, y: 5 }) {
  await act(async () => {
    fireEvent.pointerDown(el, { clientX: at.x, clientY: at.y, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: at.x, clientY: at.y, pointerId: 1 });
  });
}

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? over.personId,
    identified: over.identified ?? true,
    lifeStatus: "living",
    birthYear: null,
    deathYear: null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: over.hasHiddenParents ?? false,
    hasHiddenChildren: over.hasHiddenChildren ?? false,
  };
}

const ROOT = "p-self";

// Root "p-self" has one drawn child "marco".
const initialData: KinshipTreeData = {
  familyId: "F",
  rootPersonId: ROOT,
  nodes: [
    node({ personId: ROOT, relationToRoot: "self" }),
    node({ personId: "marco", displayName: "Marco", relationToRoot: "child" }),
  ],
  edges: [
    {
      edgeType: "parent_of",
      personAId: ROOT,
      personBId: "marco",
      nature: "biological",
      state: "asserted",
      assertedBy: ROOT,
      assertedAt: new Date(0),
      updatedAt: new Date(0),
    },
  ],
};

/** A re-root fetch centered on `id` returns a small neighborhood around it. */
function subtreeFor(id: string): KinshipTreeData {
  if (id === "marco") {
    return {
      familyId: "F",
      rootPersonId: "marco",
      nodes: [
        node({ personId: "marco", displayName: "Marco", relationToRoot: "self" }),
        node({ personId: ROOT, displayName: ROOT, relationToRoot: "parent" }),
        node({ personId: "gia", displayName: "Gia", relationToRoot: "child" }),
      ],
      edges: [
        {
          edgeType: "parent_of",
          personAId: ROOT,
          personBId: "marco",
          nature: "biological",
          state: "asserted",
          assertedBy: ROOT,
          assertedAt: new Date(0),
          updatedAt: new Date(0),
        },
        {
          edgeType: "parent_of",
          personAId: "marco",
          personBId: "gia",
          nature: "biological",
          state: "asserted",
          assertedBy: "marco",
          assertedAt: new Date(0),
          updatedAt: new Date(0),
        },
      ],
    };
  }
  return { familyId: "F", rootPersonId: id, nodes: [node({ personId: id, relationToRoot: "self" })], edges: [] };
}

it("first tap selects (opens panel); second tap on the same node re-roots", async () => {
  const fetchSubtree = vi.fn(
    async (_f: string, id: string): Promise<FetchSubtreeResult> => ({ ok: true, data: subtreeFor(id) }),
  );
  render(
    <TreeCanvas familyId="F" rootPersonId={ROOT} viewerPersonId={ROOT} initial={initialData} fetchSubtree={fetchSubtree} />,
  );
  await tap(screen.getByTestId("tree-node-marco"));
  expect(screen.getByTestId("tree-person-panel")).toBeTruthy();
  expect(fetchSubtree).not.toHaveBeenCalled();

  await tap(screen.getByTestId("tree-node-marco"));
  await waitFor(() => expect(fetchSubtree).toHaveBeenCalledWith("F", "marco"));
  // Re-rooted: the new root's newly-revealed child is drawn.
  await waitFor(() => expect(screen.getByTestId("tree-node-gia")).toBeTruthy());
});

it("a drag on a node does not select it", async () => {
  render(
    <TreeCanvas
      familyId="F"
      rootPersonId={ROOT}
      viewerPersonId={ROOT}
      initial={initialData}
      fetchSubtree={async () => ({ ok: false, error: "failed" })}
    />,
  );
  const nodeEl = screen.getByTestId("tree-node-marco");
  await act(async () => {
    fireEvent.pointerDown(nodeEl, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(nodeEl, { clientX: 40, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(nodeEl, { clientX: 40, clientY: 0, pointerId: 1 });
  });
  expect(screen.queryByTestId("tree-person-panel")).toBeNull();
});

it("fetches a boundary ancestor subtree, merges without dupes, and reveals the new node", async () => {
  // Root has a hidden parent at the boundary ⇒ an ancestors caret with requiresFetch:true.
  const boundaryInitial: KinshipTreeData = {
    familyId: "F",
    rootPersonId: ROOT,
    nodes: [node({ personId: ROOT, relationToRoot: "self", hasHiddenParents: true })],
    edges: [],
  };
  const fetched: KinshipTreeData = {
    familyId: "F",
    rootPersonId: ROOT,
    nodes: [
      node({ personId: ROOT, relationToRoot: "self", hasHiddenParents: false }),
      node({ personId: "p-mom", displayName: "Rosa", relationToRoot: "parent" }),
    ],
    edges: [
      {
        edgeType: "parent_of",
        personAId: "p-mom",
        personBId: ROOT,
        nature: "biological",
        state: "asserted",
        assertedBy: "p-mom",
        assertedAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
  };
  const fetchSubtree = vi.fn(async (): Promise<FetchSubtreeResult> => ({ ok: true, data: fetched }));
  render(
    <TreeCanvas familyId="F" rootPersonId={ROOT} viewerPersonId={ROOT} initial={boundaryInitial} fetchSubtree={fetchSubtree} />,
  );
  expect(screen.queryByTestId("tree-node-p-mom")).toBeNull();

  const caret = screen.getByTestId(`tree-affordance-ancestors-${ROOT}`);
  await act(async () => {
    caret.click();
  });
  expect(fetchSubtree).toHaveBeenCalledWith("F", ROOT);

  await waitFor(() => expect(screen.getByTestId("tree-node-p-mom")).toBeTruthy());
  expect(screen.getAllByTestId("tree-node-p-mom")).toHaveLength(1);
  expect(screen.getAllByTestId(`tree-node-${ROOT}`)).toHaveLength(1);
});

it("surfaces a load error when the boundary fetch fails, leaving the tree unchanged", async () => {
  const boundaryInitial: KinshipTreeData = {
    familyId: "F",
    rootPersonId: ROOT,
    nodes: [node({ personId: ROOT, relationToRoot: "self", hasHiddenParents: true })],
    edges: [],
  };
  const fetchSubtree = vi.fn(async (): Promise<FetchSubtreeResult> => ({ ok: false, error: "failed" }));
  render(
    <TreeCanvas familyId="F" rootPersonId={ROOT} viewerPersonId={ROOT} initial={boundaryInitial} fetchSubtree={fetchSubtree} />,
  );
  const caret = screen.getByTestId(`tree-affordance-ancestors-${ROOT}`);
  await act(async () => {
    caret.click();
  });
  await waitFor(() => expect(screen.getByTestId("tree-load-error")).toBeTruthy());
  expect(screen.queryByTestId("tree-node-p-mom")).toBeNull();
});

it("opens the read-only panel when a node is tapped", async () => {
  render(
    <TreeCanvas
      familyId="F"
      rootPersonId={ROOT}
      viewerPersonId={ROOT}
      initial={initialData}
      fetchSubtree={async () => ({ ok: false, error: "failed" })}
    />,
  );
  expect(screen.queryByTestId("tree-person-panel")).toBeNull();
  await tap(screen.getByTestId(`tree-node-${ROOT}`));
  expect(screen.getByTestId("tree-person-panel")).toBeTruthy();
});
