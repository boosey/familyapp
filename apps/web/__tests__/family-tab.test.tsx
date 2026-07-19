// @vitest-environment jsdom
/**
 * FamilyTab — the hub's Family tab content. Since #158 the Tree/List choice is URL-driven (the
 * `Family tree · List · Requests` selector lives in <FamilySurfaceNav>), so FamilyTab simply renders
 * whichever `view` the page resolved from `?view=` — there is no in-tab pill and no localStorage. This
 * component now owns only the family-selector row: the shared single-select <FamilyChips> (`?families=`)
 * with the tree's Fit/−/+ controls right-justified on it (tree view only). TreeCanvas + KinList are
 * stubbed (this is a pure view + chip-row test).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { KinshipTreeData } from "@chronicle/core";

// TreeCanvas is stubbed to ECHO the family it's rendering, so a `?families=` change (→ a different
// scopeId/familyId prop) can be asserted at the canvas boundary. KinList is a pure view stub.
vi.mock("@/app/hub/tree/tree-canvas", () => ({
  TreeCanvas: ({ familyId }: { familyId: string }) => (
    <div data-testid="mock-tree" data-family={familyId} />
  ),
}));
vi.mock("@/app/hub/tabs/KinList", () => ({ KinList: () => <div data-testid="mock-list" /> }));
// FamilyTab calls useRouter() (Slice D #6: client-side nav) and mounts <FamilyChips>, which needs
// usePathname()/useSearchParams() too. This bare mount has no Next app-router provider, so stub the
// whole next/navigation surface. `push` is shared so the chip-collapse can be asserted.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams("tab=family"),
}));

import { FamilyTab } from "@/app/hub/tabs/FamilyTab";
// The toolbar's row class — used to assert the empty-row rule fires at the FamilyTab CALL SITE (not
// just in the isolated HubToolbar unit test): the List view with <2 families must collapse R2 so only
// ONE row (R1) renders, guarding the `<FamilyChips/>`-element-vs-null truthiness trap from regressing.
import toolbarStyles from "@/app/hub/HubToolbar.module.css";

const TREE: KinshipTreeData = { familyId: "F", rootPersonId: "p1", nodes: [], edges: [] };

function renderTab(
  view?: "tree" | "list",
  extra?: Partial<{
    familyId: string;
    families: { id: string; name: string }[];
    scopeId: string;
  }>,
) {
  return render(
    <FamilyTab
      familyId={extra?.familyId ?? "F"}
      focusPersonId="p1"
      viewerPersonId="p1"
      tree={TREE}
      kin={[]}
      {...(view ? { view } : {})}
      {...(extra?.families ? { families: extra.families } : {})}
      {...(extra?.scopeId ? { scopeId: extra.scopeId } : {})}
      // #189: FamilyTab now renders the full shared toolbar; R1's data is threaded through `surface`.
      // The active view mirrors the resolved `view` (defaults to tree). No family filter/invite needed
      // for these content/chip assertions.
      surface={{ active: view ?? "tree", familiesParam: null, showRequests: false }}
    />,
  );
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

const TWO_FAMILIES = [
  { id: "fam-a", name: "Esposito" },
  { id: "fam-b", name: "Marino" },
];

describe("FamilyTab view rendering (URL-driven, #158)", () => {
  it("defaults to the Tree view (with its Fit/zoom controls)", () => {
    renderTab();
    expect(screen.getByTestId("mock-tree")).toBeTruthy();
    expect(screen.queryByTestId("mock-list")).toBeNull();
    expect(screen.getByTestId("tree-controls")).toBeTruthy();
  });

  it("renders the List view for view=list, hiding the tree controls", () => {
    renderTab("list");
    expect(screen.getByTestId("mock-list")).toBeTruthy();
    expect(screen.queryByTestId("mock-tree")).toBeNull();
    expect(screen.queryByTestId("tree-controls")).toBeNull();
  });

  it("renders NO in-tab Tree/List radiogroup (the selector moved to FamilySurfaceNav)", () => {
    renderTab();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});

describe("FamilyTab family filter chip bar (ADR-0021 §Tree, #48)", () => {
  it("renders NO chip bar for a single-family viewer (default families=[])", () => {
    renderTab();
    expect(screen.queryByRole("group", { name: "Filter by family" })).toBeNull();
  });

  it("renders the single-select chip bar when >=2 families, ON chip = the scope", () => {
    renderTab(undefined, { families: TWO_FAMILIES, scopeId: "fam-b", familyId: "fam-b" });
    expect(screen.getByRole("group", { name: "Filter by family" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Esposito" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: "Marino" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("clicking a chip COLLAPSES ?families= to that family (single-select), preserving tab", () => {
    renderTab(undefined, { families: TWO_FAMILIES, scopeId: "fam-b", familyId: "fam-b" });
    fireEvent.click(screen.getByRole("button", { name: "Esposito" }));
    const url = push.mock.calls[0]![0] as string;
    const parsed = new URL(url, "https://example.test");
    expect(parsed.searchParams.get("families")).toBe("fam-a");
    expect(parsed.searchParams.get("tab")).toBe("family");
  });

  it("the tree renders whatever family the resolved scope names (scopeId → canvas)", () => {
    const { unmount } = renderTab(undefined, {
      families: TWO_FAMILIES,
      scopeId: "fam-a",
      familyId: "fam-a",
    });
    expect(screen.getByTestId("mock-tree").getAttribute("data-family")).toBe("fam-a");
    unmount();

    renderTab(undefined, { families: TWO_FAMILIES, scopeId: "fam-b", familyId: "fam-b" });
    expect(screen.getByTestId("mock-tree").getAttribute("data-family")).toBe("fam-b");
  });
});

// #189: the load-bearing empty-row rule, asserted at the FamilyTab CALL SITE (the isolated HubToolbar
// test proves the rule; these prove FamilyTab actually TRIPS it by passing `null` — not a truthy
// <FamilyChips/> element — for the empty R2 slots). A rendered toolbar row = a `.row` element.
describe("FamilyTab shared-toolbar empty-row rule (#189)", () => {
  it("List view + <2 families → R2 empty → only ONE toolbar row (R1), flush with content", () => {
    const { container } = renderTab("list"); // default families=[] (single-family viewer)
    expect(container.querySelectorAll(`.${toolbarStyles.row}`).length).toBe(1);
    // Neither chip bar nor zoom controls → R2 truly absent.
    expect(screen.queryByRole("group", { name: "Filter by family" })).toBeNull();
    expect(screen.queryByTestId("tree-controls")).toBeNull();
  });

  it("Tree view (even <2 families) → R2 has zoom controls → BOTH rows render", () => {
    const { container } = renderTab("tree"); // single-family: no chips, but tree still gets zoom
    expect(container.querySelectorAll(`.${toolbarStyles.row}`).length).toBe(2);
    expect(screen.getByTestId("tree-controls")).toBeTruthy();
  });

  it("List view + >=2 families → R2 has the chip bar → BOTH rows render", () => {
    const { container } = renderTab("list", {
      families: TWO_FAMILIES,
      scopeId: "fam-a",
      familyId: "fam-a",
    });
    expect(container.querySelectorAll(`.${toolbarStyles.row}`).length).toBe(2);
    expect(screen.getByRole("group", { name: "Filter by family" })).toBeTruthy();
    expect(screen.queryByTestId("tree-controls")).toBeNull();
  });
});
