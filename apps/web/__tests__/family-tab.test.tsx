// @vitest-environment jsdom
/**
 * FamilyTab — the hub's Family tab (2026-07-14): a Tree | List view selector wrapping the tree canvas
 * and the searchable relatives list. The tree used to be a standalone /hub/tree route (which hid the
 * hub tab bar); now it's an in-hub tab. Verifies the selector toggles views, persists the choice to
 * localStorage, and honors a `?view=list` deep-link. TreeCanvas + KinList are stubbed (this is a pure
 * view-selector test).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hub } from "@/app/_copy";
import type { KinshipTreeData } from "@chronicle/core";

vi.mock("@/app/hub/tree/tree-canvas", () => ({ TreeCanvas: () => <div data-testid="mock-tree" /> }));
vi.mock("@/app/hub/tabs/KinList", () => ({ KinList: () => <div data-testid="mock-list" /> }));

import { FamilyTab } from "@/app/hub/tabs/FamilyTab";

const TREE: KinshipTreeData = { familyId: "F", rootPersonId: "p1", nodes: [], edges: [] };

function renderTab(initialView?: "tree" | "list") {
  return render(
    <FamilyTab
      familyId="F"
      focusPersonId="p1"
      viewerPersonId="p1"
      tree={TREE}
      kin={[]}
      {...(initialView ? { initialView } : {})}
    />,
  );
}

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("FamilyTab view selector", () => {
  it("defaults to the Tree view", () => {
    renderTab();
    expect(screen.getByTestId("mock-tree")).toBeTruthy();
    expect(screen.queryByTestId("mock-list")).toBeNull();
    expect(screen.getByRole("radio", { name: hub.tree.viewTree }).getAttribute("aria-checked")).toBe("true");
  });

  it("switches to the List view and persists the choice", () => {
    renderTab();
    fireEvent.click(screen.getByRole("radio", { name: hub.tree.viewList }));
    expect(screen.getByTestId("mock-list")).toBeTruthy();
    expect(screen.queryByTestId("mock-tree")).toBeNull();
    expect(window.localStorage.getItem("hub:familyView")).toBe("list");
  });

  it("restores a persisted List choice on mount", () => {
    window.localStorage.setItem("hub:familyView", "list");
    renderTab();
    expect(screen.getByTestId("mock-list")).toBeTruthy();
  });

  it("honors a ?view=list deep-link over the stored preference", () => {
    window.localStorage.setItem("hub:familyView", "tree");
    renderTab("list");
    expect(screen.getByTestId("mock-list")).toBeTruthy();
  });
});
