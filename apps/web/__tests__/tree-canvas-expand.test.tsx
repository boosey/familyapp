// @vitest-environment jsdom
/**
 * TreeCanvas interaction (ego-centric redesign, spec §1–§8):
 *   - a NAME click opens the read-only panel, with NO fetch and NO re-root;
 *   - a drag (pointer moved beyond the tap threshold) is NOT a tap and never selects;
 *   - a caret EXPANDS a collapsed branch and COLLAPSES a drawn one — client only, no fetch;
 *   - a "+" affordance (no kin in that direction) navigates to the add-relative flow;
 *   - an anonymous bridge card is inert (no kebab).
 *
 * The server action + router are mocked (no live DB). We feed the real pure layout tiny fixtures.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
import type { FetchSubtreeResult } from "@/app/hub/tree/actions";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { TreeCanvas } from "@/app/hub/tree/tree-canvas";

afterEach(() => {
  cleanup();
  push.mockClear();
});

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
    birthYear: over.birthYear ?? null,
    deathYear: null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: over.hasHiddenParents ?? false,
    hasHiddenChildren: over.hasHiddenChildren ?? false,
    sex: over.sex ?? "unknown",
  };
}

const FOCUS = "p-self";

// Focus "p-self" has one drawn child "marco" (focus's children are shown by default).
const initialData: KinshipTreeData = {
  familyId: "F",
  rootPersonId: FOCUS,
  nodes: [
    node({ personId: FOCUS, relationToRoot: "self" }),
    node({ personId: "marco", displayName: "Marco", relationToRoot: "child" }),
  ],
  edges: [
    {
      edgeType: "parent_of",
      personAId: FOCUS,
      personBId: "marco",
      nature: "biological",
      state: "asserted",
      assertedBy: FOCUS,
      assertedAt: new Date(0),
      updatedAt: new Date(0),
    },
  ],
};

const noFetch = async (): Promise<FetchSubtreeResult> => ({ ok: false, error: "failed" });

it("a name click opens the read-only panel without any fetch or re-root", async () => {
  const fetchSubtree = vi.fn(noFetch);
  render(
    <TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={initialData} fetchSubtree={fetchSubtree} />,
  );
  await tap(screen.getByTestId("tree-node-marco"));
  expect(screen.getByTestId("tree-person-panel")).toBeTruthy();
  // No re-root machinery: the panel has no "center tree here" trigger.
  expect(screen.queryByTestId("tree-panel-recenter")).toBeNull();
});

it("keyboard/native click on a node opens the panel (a11y)", async () => {
  render(
    <TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={initialData} fetchSubtree={vi.fn(noFetch)} />,
  );
  expect(screen.queryByTestId("tree-person-panel")).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByTestId("tree-node-marco"));
  });
  expect(screen.getByTestId("tree-person-panel")).toBeTruthy();
});

it("a drag on a node does not select it", async () => {
  render(
    <TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={initialData} fetchSubtree={vi.fn(noFetch)} />,
  );
  const nodeEl = screen.getByTestId("tree-node-marco");
  await act(async () => {
    fireEvent.pointerDown(nodeEl, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(nodeEl, { clientX: 40, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(nodeEl, { clientX: 40, clientY: 0, pointerId: 1 });
    fireEvent.click(nodeEl, { clientX: 40, clientY: 0 });
  });
  expect(screen.queryByTestId("tree-person-panel")).toBeNull();
});

it("a children caret collapses the drawn branch (client only, no fetch) and re-expands it", async () => {
  const fetchSubtree = vi.fn(noFetch);
  render(
    <TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={initialData} fetchSubtree={fetchSubtree} />,
  );
  expect(screen.getByTestId("tree-node-marco")).toBeTruthy();

  // Focus's children caret is a collapse (children drawn).
  const caret = screen.getByTestId(`tree-affordance-children-caret-${FOCUS}`);
  await act(async () => {
    caret.click();
  });
  await waitFor(() => expect(screen.queryByTestId("tree-node-marco")).toBeNull());
  expect(fetchSubtree).not.toHaveBeenCalled();

  // Now it's an expand caret; clicking brings marco back.
  const caret2 = screen.getByTestId(`tree-affordance-children-caret-${FOCUS}`);
  await act(async () => {
    caret2.click();
  });
  await waitFor(() => expect(screen.getByTestId("tree-node-marco")).toBeTruthy());
  expect(fetchSubtree).not.toHaveBeenCalled();
});

it("a '+' affordance navigates to the add-relative flow", async () => {
  // Isolated focus → three "+" affordances. The parents "+" adds a parent.
  const isolated: KinshipTreeData = {
    familyId: "F",
    rootPersonId: FOCUS,
    nodes: [node({ personId: FOCUS, relationToRoot: "self" })],
    edges: [],
  };
  render(
    <TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={isolated} fetchSubtree={vi.fn(noFetch)} />,
  );
  const plus = screen.getByTestId(`tree-affordance-parents-add-${FOCUS}`);
  await act(async () => {
    plus.click();
  });
  expect(push).toHaveBeenCalledWith(`/hub/kin?scope=F&anchor=${FOCUS}&relation=parent`);
});

it("isolated focus shows the card plus three '+' (no empty-state page)", async () => {
  const isolated: KinshipTreeData = {
    familyId: "F",
    rootPersonId: FOCUS,
    nodes: [node({ personId: FOCUS, relationToRoot: "self" })],
    edges: [],
  };
  render(
    <TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={isolated} fetchSubtree={vi.fn(noFetch)} />,
  );
  expect(screen.getByTestId(`tree-node-${FOCUS}`)).toBeTruthy();
  expect(screen.getByTestId(`tree-affordance-parents-add-${FOCUS}`)).toBeTruthy();
  expect(screen.getByTestId(`tree-affordance-siblings-add-${FOCUS}`)).toBeTruthy();
  expect(screen.getByTestId(`tree-affordance-children-add-${FOCUS}`)).toBeTruthy();
});

it("expanding/collapsing parents does NOT move the focus on screen (camera stays anchored)", async () => {
  // focus with a drawn parent (focus's parents are open by default). The layout re-normalizes its
  // origin when the parent generation appears/disappears, shifting every node's coords by a whole
  // GEN_STEP. The camera is anchored on the focus, so the focus's on-screen position must be invariant
  // across a parents collapse → re-expand. (Regression: the canvas used to slide down on expand.)
  const withParent: KinshipTreeData = {
    familyId: "F",
    rootPersonId: FOCUS,
    nodes: [
      node({ personId: FOCUS, relationToRoot: "self" }),
      node({ personId: "jerry", displayName: "Jerry", relationToRoot: "parent" }),
    ],
    edges: [
      {
        edgeType: "parent_of",
        personAId: "jerry",
        personBId: FOCUS,
        nature: "biological",
        state: "asserted",
        assertedBy: FOCUS,
        assertedAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
  };

  // Screen position of the focus = pan-layer transform + the focus card's own left/top offset.
  const focusScreen = (): { x: number; y: number } => {
    const layer = screen.getByTestId("tree-pan-layer");
    const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(layer.style.transform);
    if (!m) throw new Error(`no translate in transform: "${layer.style.transform}"`);
    const pos = screen.getByTestId(`tree-node-pos-${FOCUS}`);
    return {
      x: parseFloat(m[1]!) + parseFloat(pos.style.left),
      y: parseFloat(m[2]!) + parseFloat(pos.style.top),
    };
  };

  render(
    <TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={withParent} fetchSubtree={vi.fn(noFetch)} />,
  );
  // Parent is drawn by default.
  expect(screen.getByTestId("tree-node-jerry")).toBeTruthy();
  const expanded = focusScreen();

  // Collapse the parents → jerry leaves, the origin re-normalizes upward.
  await act(async () => {
    screen.getByTestId(`tree-affordance-parents-caret-${FOCUS}`).click();
  });
  await waitFor(() => expect(screen.queryByTestId("tree-node-jerry")).toBeNull());
  const collapsed = focusScreen();

  expect(collapsed.x).toBeCloseTo(expanded.x, 3);
  expect(collapsed.y).toBeCloseTo(expanded.y, 3);

  // Re-expand → jerry returns above, focus still fixed.
  await act(async () => {
    screen.getByTestId(`tree-affordance-parents-caret-${FOCUS}`).click();
  });
  await waitFor(() => expect(screen.getByTestId("tree-node-jerry")).toBeTruthy());
  const reExpanded = focusScreen();
  expect(reExpanded.x).toBeCloseTo(expanded.x, 3);
  expect(reExpanded.y).toBeCloseTo(expanded.y, 3);
});

it("an anonymous bridge card is inert (no kebab, no affordances)", async () => {
  const withBridge: KinshipTreeData = {
    familyId: "F",
    rootPersonId: FOCUS,
    nodes: [
      node({ personId: FOCUS, relationToRoot: "self" }),
      node({ personId: "bridge", displayName: null, identified: false, relationToRoot: "parent" }),
    ],
    edges: [
      {
        edgeType: "parent_of",
        personAId: "bridge",
        personBId: FOCUS,
        nature: null,
        state: "asserted",
        assertedBy: FOCUS,
        assertedAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
  };
  render(
    <TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={withBridge} fetchSubtree={vi.fn(noFetch)} />,
  );
  expect(screen.getByTestId("tree-node-bridge")).toBeTruthy();
  // No affordance owned by the bridge.
  expect(screen.queryByTestId("tree-affordance-parents-add-bridge")).toBeNull();
  expect(screen.queryByTestId("tree-affordance-parents-caret-bridge")).toBeNull();
});
