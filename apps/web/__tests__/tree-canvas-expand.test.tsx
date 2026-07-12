// @vitest-environment jsdom
/**
 * TreeCanvas fetch-on-expand (spec §7): tapping a BOUNDARY caret (a node whose kin aren't loaded)
 * calls the injected server action and merges the returned nodes/edges WITHOUT duplicating anything,
 * then reveals them via a re-run of the pure layout. Also covers the Fit control and node tap → panel.
 *
 * The server action is mocked (no live DB). We feed the real pure layout a tiny fixture whose root has
 * `hasHiddenParents`, so the layout emits an `expand-parents` affordance with `requiresFetch: true`.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
import { TreeCanvas } from "@/app/hub/tree/tree-canvas";
import type { FetchSubtreeResult } from "@/app/hub/tree/actions";

afterEach(cleanup);

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

// Root has a hidden parent at the boundary ⇒ an expand-parents caret with requiresFetch:true.
const initial: KinshipTreeData = {
  familyId: "fam-1",
  rootPersonId: ROOT,
  nodes: [node({ personId: ROOT, relationToRoot: "self", hasHiddenParents: true })],
  edges: [],
};

// The fetched subtree materializes the previously-hidden parent (and re-states the root, with its
// boundary flag now cleared).
const fetched: KinshipTreeData = {
  familyId: "fam-1",
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

it("fetches a boundary subtree, merges without dupes, and reveals the new node", async () => {
  const fetchSubtree = vi.fn(
    async (_familyId: string, _centerPersonId: string): Promise<FetchSubtreeResult> => ({
      ok: true,
      data: fetched,
    }),
  );

  render(<TreeCanvas familyId="fam-1" rootPersonId={ROOT} initial={initial} fetchSubtree={fetchSubtree} />);

  // The boundary parent isn't drawn yet.
  expect(screen.queryByTestId("tree-node-p-mom")).toBeNull();

  const caret = screen.getByTestId(`tree-affordance-expand-parents-${ROOT}`);
  await act(async () => {
    caret.click();
  });

  expect(fetchSubtree).toHaveBeenCalledWith("fam-1", ROOT);

  // After merge + reveal, the parent is drawn — exactly once (no duplicate root/parent nodes).
  await waitFor(() => expect(screen.getByTestId("tree-node-p-mom")).toBeTruthy());
  expect(screen.getAllByTestId("tree-node-p-mom")).toHaveLength(1);
  expect(screen.getAllByTestId(`tree-node-${ROOT}`)).toHaveLength(1);
});

it("surfaces a load error when the fetch fails, leaving the tree unchanged", async () => {
  const fetchSubtree = vi.fn(
    async (_familyId: string, _centerPersonId: string): Promise<FetchSubtreeResult> => ({
      ok: false,
      error: "failed",
    }),
  );

  render(<TreeCanvas familyId="fam-1" rootPersonId={ROOT} initial={initial} fetchSubtree={fetchSubtree} />);
  const caret = screen.getByTestId(`tree-affordance-expand-parents-${ROOT}`);
  await act(async () => {
    caret.click();
  });

  await waitFor(() => expect(screen.getByTestId("tree-load-error")).toBeTruthy());
  expect(screen.queryByTestId("tree-node-p-mom")).toBeNull();
});

it("re-centering (keyed remount) loads the new root's data, not the previous root's stale set", async () => {
  // Regression (cold-review round 2): "Center tree here" is a SOFT navigation to ?root=. Because
  // TreeCanvas seeds nodes/edges from `initial` via a useState INITIALIZER (read once), a bare re-render
  // with new props would keep the OLD root's nodes and render blank against a root absent from them.
  // The page fixes this by keying <TreeCanvas> on the root so it remounts fresh — assert that keyed
  // remount surfaces the NEW root's neighborhood.
  const first: KinshipTreeData = {
    familyId: "fam-1",
    rootPersonId: ROOT,
    nodes: [node({ personId: ROOT, relationToRoot: "self" }), node({ personId: "p-mom", relationToRoot: "parent" })],
    edges: fetched.edges,
  };
  const second: KinshipTreeData = {
    familyId: "fam-1",
    rootPersonId: "p-mom",
    nodes: [
      node({ personId: "p-mom", relationToRoot: "self" }),
      node({ personId: "p-gran", displayName: "Ada", relationToRoot: "parent" }),
    ],
    edges: [
      {
        edgeType: "parent_of",
        personAId: "p-gran",
        personBId: "p-mom",
        nature: "biological",
        state: "asserted",
        assertedBy: "p-gran",
        assertedAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
  };
  const noop = async (): Promise<FetchSubtreeResult> => ({ ok: false, error: "failed" });
  const { rerender } = render(
    <TreeCanvas key={ROOT} familyId="fam-1" rootPersonId={ROOT} initial={first} fetchSubtree={noop} />,
  );
  expect(screen.getByTestId("tree-node-p-mom")).toBeTruthy();

  // Simulate the soft re-center navigation: same route, new key + new root + new data.
  rerender(
    <TreeCanvas key="p-mom" familyId="fam-1" rootPersonId="p-mom" initial={second} fetchSubtree={noop} />,
  );
  // The new root's kin ("p-gran") is drawn; the old-only node ("p-self") is gone.
  expect(screen.getByTestId("tree-node-p-gran")).toBeTruthy();
  expect(screen.queryByTestId(`tree-node-${ROOT}`)).toBeNull();
});

it("opens the read-only panel when a node is tapped", async () => {
  const noop = async (): Promise<FetchSubtreeResult> => ({ ok: false, error: "failed" });
  render(<TreeCanvas familyId="fam-1" rootPersonId={ROOT} initial={initial} fetchSubtree={noop} />);
  expect(screen.queryByTestId("tree-person-panel")).toBeNull();
  await act(async () => {
    screen.getByTestId(`tree-node-${ROOT}`).click();
  });
  expect(screen.getByTestId("tree-person-panel")).toBeTruthy();
});
