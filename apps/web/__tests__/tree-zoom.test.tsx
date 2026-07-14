// @vitest-environment jsdom
/**
 * TreeCanvas zoom + Fit (2026-07-14). The tree became a hub tab and gained real zoom: the "Fit" button
 * now ZOOMS the whole loaded tree to the viewport (the old Fit only recentred the focus at 1×), and
 * +/− buttons step the zoom about the focus. We read the pan-layer's `scale(...)` out of its transform.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
import type { FetchSubtreeResult } from "@/app/hub/tree/actions";
import { TreeCanvas } from "@/app/hub/tree/tree-canvas";

afterEach(cleanup);

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? over.personId,
    identified: true,
    lifeStatus: "living",
    birthYear: null,
    deathYear: null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: "unknown",
  };
}

const FOCUS = "p-self";
const data: KinshipTreeData = {
  familyId: "F",
  rootPersonId: FOCUS,
  nodes: [
    node({ personId: FOCUS, relationToRoot: "self" }),
    node({ personId: "kid", displayName: "Kid", relationToRoot: "child" }),
  ],
  edges: [
    {
      edgeType: "parent_of",
      personAId: FOCUS,
      personBId: "kid",
      nature: "biological",
      state: "asserted",
      assertedBy: FOCUS,
      assertedAt: new Date(0),
      updatedAt: new Date(0),
    },
  ],
};

const noFetch = async (): Promise<FetchSubtreeResult> => ({ ok: false, error: "failed" });

function scaleOf(): number {
  const layer = screen.getByTestId("tree-pan-layer");
  const m = /scale\(\s*(-?[\d.]+)\s*\)/.exec(layer.style.transform);
  if (!m) throw new Error(`no scale in transform: "${layer.style.transform}"`);
  return parseFloat(m[1]!);
}

it("renders Fit + zoom-in + zoom-out controls", () => {
  render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={data} fetchSubtree={vi.fn(noFetch)} />);
  expect(screen.getByTestId("tree-fit")).toBeTruthy();
  expect(screen.getByTestId("tree-zoom-in")).toBeTruthy();
  expect(screen.getByTestId("tree-zoom-out")).toBeTruthy();
});

it("starts at 1× and zoom-in / zoom-out change the scale", async () => {
  render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={data} fetchSubtree={vi.fn(noFetch)} />);
  expect(scaleOf()).toBeCloseTo(1, 5);

  await act(async () => screen.getByTestId("tree-zoom-in").click());
  expect(scaleOf()).toBeGreaterThan(1);

  const zoomed = scaleOf();
  await act(async () => screen.getByTestId("tree-zoom-out").click());
  expect(scaleOf()).toBeLessThan(zoomed);
});

it("Fit sets a finite zoom-to-fit scale (not a no-op recenter)", async () => {
  render(<TreeCanvas familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} initial={data} fetchSubtree={vi.fn(noFetch)} />);
  // Zoom in first so Fit visibly changes the scale back to a fitted value.
  await act(async () => screen.getByTestId("tree-zoom-in").click());
  await act(async () => screen.getByTestId("tree-zoom-in").click());
  const before = scaleOf();
  await act(async () => screen.getByTestId("tree-fit").click());
  const after = scaleOf();
  expect(after).not.toBeCloseTo(before, 5);
  expect(Number.isFinite(after)).toBe(true);
  expect(after).toBeGreaterThan(0);
});
