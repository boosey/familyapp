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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

// useIsCompact still gates Place→tap→zone (#288). Zoom/fit live on the progressive Views unit (#297).
let compact = false;
vi.mock("@/app/_kindred/useIsCompact", () => ({ useIsCompact: () => compact }));

import { FamilyTab } from "@/app/hub/tabs/FamilyTab";

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
      listPeople={[]}
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
  compact = false;
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
    const row = document.querySelector("[data-hub-progressive-control-row]");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByTestId("tree-controls")).toBeTruthy();
  });

  it("renders the List view for view=list, hiding the tree controls", () => {
    renderTab("list");
    expect(screen.getByTestId("mock-list")).toBeTruthy();
    expect(screen.queryByTestId("mock-tree")).toBeNull();
    expect(screen.queryByTestId("tree-controls")).toBeNull();
  });

  it("#283: List view mounts no unplaced mutation tray and no governable-edges section", () => {
    render(
      <FamilyTab
        familyId="F"
        focusPersonId="p1"
        viewerPersonId="p1"
        tree={TREE}
        listPeople={[]}
        view="list"
        unplaced={[
          { personId: "u1", displayName: "Rosa", role: "member" },
          { personId: "u2", displayName: "Marco", role: "member" },
        ]}
        viewerIsSteward={true}
        governableEdges={[
          {
            edgeType: "parent_of",
            personAId: "a",
            personBId: "b",
            personADisplayName: "A",
            personAIdentified: true,
            personBDisplayName: "B",
            personBIdentified: true,
            nature: null,
            state: "asserted",
            assertedBy: "p1",
            viewerIsSteward: true,
            viewerCanRemove: true,
            viewerCanHide: false,
          },
        ]}
        surface={{ active: "list", familiesParam: null, showRequests: false }}
      />,
    );
    expect(screen.getByTestId("mock-list")).toBeTruthy();
    expect(screen.queryByTestId("unplaced-members")).toBeNull();
    expect(screen.queryByTestId("unplaced-place-u1")).toBeNull();
    expect(screen.queryByTestId("unplaced-nonfamily-u1")).toBeNull();
    expect(screen.queryByTestId("unplaced-remove-u1")).toBeNull();
    expect(screen.queryByTestId("family-gov-edges")).toBeNull();
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

// #297: progressive occupancy at the FamilyTab call site — omit absent units (no truthy empty
// <FamilyChips/>), keep zoom as Views on tree, single progressive row (no HubToolbar).
describe("FamilyTab progressive control occupancy (#297)", () => {
  it("List view + <2 families → Sub tabs only (no Family / Views units)", () => {
    const { container } = renderTab("list"); // default families=[] (single-family viewer)
    const row = container.querySelector("[data-hub-progressive-control-row]");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-family")).toBe("none");
    expect(row?.getAttribute("data-views")).toBe("none");
    expect(document.querySelector("[data-hub-toolbar]")).toBeNull();
    expect(screen.queryByRole("group", { name: "Filter by family" })).toBeNull();
    expect(screen.queryByTestId("tree-controls")).toBeNull();
  });

  it("Tree view (even <2 families) → Views unit has zoom controls; no Family unit", () => {
    const { container } = renderTab("tree");
    const row = container.querySelector("[data-hub-progressive-control-row]");
    expect(row?.getAttribute("data-family")).toBe("none");
    expect(row?.getAttribute("data-views")).toBe("expanded");
    expect(within(row as HTMLElement).getByTestId("tree-controls")).toBeTruthy();
  });

  it("List view + >=2 families → Family unit present; no Views", () => {
    const { container } = renderTab("list", {
      families: TWO_FAMILIES,
      scopeId: "fam-a",
      familyId: "fam-a",
    });
    const row = container.querySelector("[data-hub-progressive-control-row]");
    expect(row?.getAttribute("data-family")).toBe("expanded");
    expect(row?.getAttribute("data-views")).toBe("none");
    expect(screen.getByRole("group", { name: "Filter by family" })).toBeTruthy();
    expect(screen.queryByTestId("tree-controls")).toBeNull();
  });
});

// #297: zoom/fit are the Views unit on the progressive row (including compact) — no canvas float.
describe("FamilyTab — zoom lives on progressive Views (not a canvas float)", () => {
  it("tree view: zoom controls are only inside the progressive row", () => {
    compact = true;
    const { container } = renderTab("tree");
    const row = container.querySelector("[data-hub-progressive-control-row]");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByTestId("tree-controls")).toBeTruthy();
    // Measure probes duplicate the node outside the row; nothing else in the tree frame should host it.
    const outsideRow = [...container.querySelectorAll('[data-testid="tree-controls"]')].filter(
      (el) => !row!.contains(el) && !el.closest('[aria-hidden="true"]'),
    );
    expect(outsideRow).toHaveLength(0);
  });

  it("list view: no tree-controls", () => {
    compact = true;
    renderTab("list");
    expect(screen.queryByTestId("tree-controls")).toBeNull();
  });
});
