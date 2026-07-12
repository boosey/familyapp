// @vitest-environment jsdom
/**
 * TreeCanvas interaction (pedigree-nav redesign):
 *   - a NAME click (pointerdown+up at the same point) SELECTS a node → opens the read-only panel,
 *     without any fetch;
 *   - re-rooting is NOT a node gesture anymore — it happens ONLY via the panel's "Center tree here"
 *     button, which fetches the neighborhood, merges it, relabels, and reveals the new root's kin;
 *   - a drag (pointer moved beyond the tap threshold) is NOT a tap and never selects;
 *   - activating a FRONTIER CHEVRON (parents/children not loaded) fetches that subtree, merges without
 *     dupes, and reveals the new node;
 *   - a fetch failure surfaces the load error and leaves the tree unchanged.
 *
 * The server action is mocked (no live DB). We feed the real pure layout tiny fixtures.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
import { TreeCanvas } from "@/app/hub/tree/tree-canvas";
import type { FetchSubtreeResult } from "@/app/hub/tree/actions";

afterEach(cleanup);

/**
 * Simulate a real tap: pointerdown, pointerup, then the synthetic click the browser fires — at the
 * same point on the node card. jsdom does NOT auto-fire click after pointerup, so we dispatch it
 * explicitly (a real browser would). Selection is driven by the button's onClick + a drag guard, so a
 * faithful tap must include the click.
 */
async function tap(el: Element, at: { x: number; y: number } = { x: 5, y: 5 }) {
  await act(async () => {
    fireEvent.pointerDown(el, { clientX: at.x, clientY: at.y, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: at.x, clientY: at.y, pointerId: 1 });
    fireEvent.click(el, { clientX: at.x, clientY: at.y });
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
    sex: over.sex ?? "unknown",
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

it("a name click selects (opens the panel) without any fetch", async () => {
  const fetchSubtree = vi.fn(
    async (_f: string, id: string): Promise<FetchSubtreeResult> => ({ ok: true, data: subtreeFor(id) }),
  );
  render(
    <TreeCanvas familyId="F" rootPersonId={ROOT} viewerPersonId={ROOT} initial={initialData} fetchSubtree={fetchSubtree} />,
  );
  await tap(screen.getByTestId("tree-node-marco"));
  expect(screen.getByTestId("tree-person-panel")).toBeTruthy();
  expect(fetchSubtree).not.toHaveBeenCalled();
});

it("keyboard/native click on a node opens the panel and does NOT re-root (a11y regression, Finding 2)", async () => {
  // A keyboard Enter/Space on the node <button> fires a native click with NO pointer events. The
  // canvas must still open the panel (else keyboard-only users can't reach Center/add-relative), and
  // it must NOT re-root (no fetch) on a plain activation.
  const fetchSubtree = vi.fn(
    async (_f: string, id: string): Promise<FetchSubtreeResult> => ({ ok: true, data: subtreeFor(id) }),
  );
  render(
    <TreeCanvas familyId="F" rootPersonId={ROOT} viewerPersonId={ROOT} initial={initialData} fetchSubtree={fetchSubtree} />,
  );
  expect(screen.queryByTestId("tree-person-panel")).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByTestId("tree-node-marco"));
  });
  expect(screen.getByTestId("tree-person-panel")).toBeTruthy();
  // Plain activation never re-roots.
  expect(fetchSubtree).not.toHaveBeenCalled();
});

it("re-roots via the panel's 'Center tree here', revealing the new root's kin", async () => {
  const fetchSubtree = vi.fn(
    async (_f: string, id: string): Promise<FetchSubtreeResult> => ({ ok: true, data: subtreeFor(id) }),
  );
  render(
    <TreeCanvas familyId="F" rootPersonId={ROOT} viewerPersonId={ROOT} initial={initialData} fetchSubtree={fetchSubtree} />,
  );
  // Select marco, then press the panel's re-root button (the ONLY re-root trigger).
  await tap(screen.getByTestId("tree-node-marco"));
  await act(async () => {
    screen.getByTestId("tree-panel-recenter").click();
  });
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
    // A browser still fires a click after a drag-release on the element; the drag guard must swallow it.
    fireEvent.click(nodeEl, { clientX: 40, clientY: 0 });
  });
  expect(screen.queryByTestId("tree-person-panel")).toBeNull();
});

it("reveals a frontier ancestor subtree, merges without dupes, and draws the new node", async () => {
  // Root has a hidden parent at the boundary ⇒ an ancestors chevron on its right edge.
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

  const chevron = screen.getByTestId(`tree-chevron-ancestors-${ROOT}`);
  await act(async () => {
    chevron.click();
  });
  expect(fetchSubtree).toHaveBeenCalledWith("F", ROOT);

  await waitFor(() => expect(screen.getByTestId("tree-node-p-mom")).toBeTruthy());
  expect(screen.getAllByTestId("tree-node-p-mom")).toHaveLength(1);
  expect(screen.getAllByTestId(`tree-node-${ROOT}`)).toHaveLength(1);
});

it("a descendants chevron reveals children (fetches that node's subtree)", async () => {
  // Root has hidden children at the boundary ⇒ a descendants chevron on its LEFT edge → fetch children.
  const boundaryInitial: KinshipTreeData = {
    familyId: "F",
    rootPersonId: ROOT,
    nodes: [node({ personId: ROOT, relationToRoot: "self", hasHiddenChildren: true })],
    edges: [],
  };
  const fetched: KinshipTreeData = {
    familyId: "F",
    rootPersonId: ROOT,
    nodes: [
      node({ personId: ROOT, relationToRoot: "self", hasHiddenChildren: false }),
      node({ personId: "kid", displayName: "Kid", relationToRoot: "child" }),
    ],
    edges: [
      {
        edgeType: "parent_of",
        personAId: ROOT,
        personBId: "kid",
        nature: "biological",
        state: "asserted",
        assertedBy: ROOT,
        assertedAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
  };
  const fetchSubtree = vi.fn(async (): Promise<FetchSubtreeResult> => ({ ok: true, data: fetched }));
  render(
    <TreeCanvas familyId="F" rootPersonId={ROOT} viewerPersonId={ROOT} initial={boundaryInitial} fetchSubtree={fetchSubtree} />,
  );
  const chevron = screen.getByTestId(`tree-chevron-descendants-${ROOT}`);
  await act(async () => {
    chevron.click();
  });
  expect(fetchSubtree).toHaveBeenCalledWith("F", ROOT);
  await waitFor(() => expect(screen.getByTestId("tree-node-kid")).toBeTruthy());
});

it("surfaces a load error when the frontier fetch fails, leaving the tree unchanged", async () => {
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
  const chevron = screen.getByTestId(`tree-chevron-ancestors-${ROOT}`);
  await act(async () => {
    chevron.click();
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
