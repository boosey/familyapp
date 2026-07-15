// @vitest-environment jsdom
/**
 * Fit / − / + controls now live in FamilyTab's view-selector row (tree Slice A §5), not inside
 * TreeCanvas. pan/scale are lifted to FamilyTab and passed to TreeCanvas as controlled props; Fit is
 * called through TreeCanvas's imperative handle. These tests drive the controls from FamilyTab and read
 * the resulting `scale(...)` out of the pan-layer transform — and assert the LIST view hides them.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
// FamilyTab calls useRouter() (Slice D #6: client-side nav) and now mounts <FamilyChips>, which calls
// usePathname()/useSearchParams() unconditionally (React hooks run before its <2-family self-hide).
// This bare mount has no Next app-router provider, so stub the whole surface. These tests pass no
// `families`, so FamilyChips self-hides after the hooks return — no chip bar is rendered.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));
import { FamilyTab } from "@/app/hub/tabs/FamilyTab";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

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
    inviteStatus: over.inviteStatus ?? "not-applicable",
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

function renderTab() {
  return render(
    <FamilyTab familyId="F" focusPersonId={FOCUS} viewerPersonId={FOCUS} tree={data} kin={[]} />,
  );
}

function scaleOf(): number {
  const layer = screen.getByTestId("tree-pan-layer");
  const m = /scale\(\s*(-?[\d.]+)\s*\)/.exec(layer.style.transform);
  if (!m) throw new Error(`no scale in transform: "${layer.style.transform}"`);
  return parseFloat(m[1]!);
}

it("renders Fit + zoom-in + zoom-out controls in the selector row (tree view)", () => {
  renderTab();
  expect(screen.getByTestId("tree-controls")).toBeTruthy();
  expect(screen.getByTestId("tree-fit")).toBeTruthy();
  expect(screen.getByTestId("tree-zoom-in")).toBeTruthy();
  expect(screen.getByTestId("tree-zoom-out")).toBeTruthy();
});

it("the list view hides the tree controls", async () => {
  renderTab();
  expect(screen.getByTestId("tree-controls")).toBeTruthy();
  await act(async () => screen.getByRole("radio", { name: /list/i }).click());
  expect(screen.queryByTestId("tree-controls")).toBeNull();
  expect(screen.queryByTestId("tree-fit")).toBeNull();
});

it("the row controls DRIVE the canvas: zoom in/out change the scale", async () => {
  renderTab();
  expect(scaleOf()).toBeCloseTo(1, 5);

  await act(async () => screen.getByTestId("tree-zoom-in").click());
  expect(scaleOf()).toBeGreaterThan(1);

  const zoomed = scaleOf();
  await act(async () => screen.getByTestId("tree-zoom-out").click());
  expect(scaleOf()).toBeLessThan(zoomed);
});

it("Fit (via the imperative handle) sets a finite zoom-to-fit scale", async () => {
  renderTab();
  await act(async () => screen.getByTestId("tree-zoom-in").click());
  await act(async () => screen.getByTestId("tree-zoom-in").click());
  const before = scaleOf();
  await act(async () => screen.getByTestId("tree-fit").click());
  const after = scaleOf();
  expect(after).not.toBeCloseTo(before, 5);
  expect(Number.isFinite(after)).toBe(true);
  expect(after).toBeGreaterThan(0);
});
