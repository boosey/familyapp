// @vitest-environment jsdom
/**
 * Fit / − / + controls live on FamilyTab's family-selector row (#159), not inside TreeCanvas. pan/scale
 * are lifted to FamilyTab and passed to TreeCanvas as controlled props; Fit is called through
 * TreeCanvas's imperative handle. These tests drive the controls from FamilyTab and read the resulting
 * `scale(...)` out of the pan-layer transform — and assert the LIST view (rendered via the `view` prop,
 * URL-driven since #158) hides them.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
// FamilyTab calls useRouter() (Slice D #6: client-side nav) and mounts <FamilyChips>, which calls
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
    membership: over.membership ?? "tree-only",
    isSteward: over.isSteward ?? false,
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

function renderTab(view: "tree" | "list" = "tree") {
  return render(
    <FamilyTab
      familyId="F"
      focusPersonId={FOCUS}
      viewerPersonId={FOCUS}
      tree={data}
      listPeople={[]}
      view={view}
      // #189: FamilyTab renders the full shared toolbar; R1's data comes via `surface`. Irrelevant to
      // the zoom/camera assertions here, so a minimal single-family (no chips), no-invite surface.
      surface={{ active: view, familiesParam: null, showRequests: false }}
    />,
  );
}

/** Live progressive row only — HubProgressiveControlRow also mounts aria-hidden measure clones
 *  of Views (Fit/−/+) that duplicate data-testid and break document-wide getByTestId. */
function controlRow(): HTMLElement {
  const row = document.querySelector("[data-hub-progressive-control-row]");
  if (!row) throw new Error("missing [data-hub-progressive-control-row]");
  return row as HTMLElement;
}

function scaleOf(): number {
  const layer = screen.getByTestId("tree-pan-layer");
  const m = /scale\(\s*(-?[\d.]+)\s*\)/.exec(layer.style.transform);
  if (!m) throw new Error(`no scale in transform: "${layer.style.transform}"`);
  return parseFloat(m[1]!);
}

it("renders Fit + zoom-in + zoom-out controls on the family-selector row (tree view)", () => {
  renderTab();
  const row = within(controlRow());
  expect(row.getByTestId("tree-controls")).toBeTruthy();
  expect(row.getByTestId("tree-fit")).toBeTruthy();
  expect(row.getByTestId("tree-zoom-in")).toBeTruthy();
  expect(row.getByTestId("tree-zoom-out")).toBeTruthy();
});

it("the list view hides the tree controls", () => {
  renderTab("list");
  expect(screen.queryByTestId("tree-controls")).toBeNull();
  expect(screen.queryByTestId("tree-fit")).toBeNull();
});

it("the row controls DRIVE the canvas: zoom in/out change the scale", async () => {
  renderTab();
  const row = within(controlRow());
  expect(scaleOf()).toBeCloseTo(1, 5);

  await act(async () => row.getByTestId("tree-zoom-in").click());
  expect(scaleOf()).toBeGreaterThan(1);

  const zoomed = scaleOf();
  await act(async () => row.getByTestId("tree-zoom-out").click());
  expect(scaleOf()).toBeLessThan(zoomed);
});

it("Fit (via the imperative handle) sets a finite zoom-to-fit scale", async () => {
  renderTab();
  const row = within(controlRow());
  await act(async () => row.getByTestId("tree-zoom-in").click());
  await act(async () => row.getByTestId("tree-zoom-in").click());
  const before = scaleOf();
  await act(async () => row.getByTestId("tree-fit").click());
  const after = scaleOf();
  expect(after).not.toBeCloseTo(before, 5);
  expect(Number.isFinite(after)).toBe(true);
  expect(after).toBeGreaterThan(0);
});
