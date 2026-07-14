// @vitest-environment jsdom
/**
 * PersonPanel — read-only detail panel (ego-centric redesign, spec §2). It NEVER re-roots (the old
 * "Center tree here" action is gone) and never writes. It shows the relation-to-VIEWER (passed in as
 * `relationToViewer`, derived client-side by the canvas since the tree is focus-rooted), links to
 * Stories, and offers "Add parent/child/sibling/partner" which now open the tree's Add modal (via
 * TreeAddProvider) anchored on the person — /hub/kin navigation and "Manage kin" are gone (2026-07-14).
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { hub } from "@/app/_copy";
import type { TreeNode } from "@chronicle/core";
import { PersonPanel } from "@/app/hub/tree/person-panel";
import { TreeAddProvider, type OpenAddRelative } from "@/app/hub/tree/add-relative-context";

afterEach(cleanup);

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: "displayName" in over ? (over.displayName ?? null) : "Marco",
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    birthYear: over.birthYear ?? 1980,
    deathYear: over.deathYear ?? null,
    relationToRoot: over.relationToRoot ?? "child",
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: over.sex ?? "unknown",
  };
}

function renderPanel(
  n: TreeNode,
  opts: { relationToViewer?: "self" | null | "child" | "cousin"; onClose?: () => void; onAdd?: OpenAddRelative } = {},
) {
  return render(
    <TreeAddProvider value={opts.onAdd ?? (() => {})}>
      <PersonPanel
        node={n}
        relationToViewer={opts.relationToViewer ?? "child"}
        onClose={opts.onClose ?? (() => {})}
      />
    </TreeAddProvider>,
  );
}

it("links Stories to the about route", () => {
  renderPanel(node({ personId: "p9" }));
  const el = screen.getByTestId("tree-panel-stories");
  const anchor = el.tagName === "A" ? el : el.closest("a");
  expect(anchor?.getAttribute("href")).toBe("/hub/about/p9");
});

it("has no 'Manage kin' link (governance moved off the panel)", () => {
  renderPanel(node({ personId: "p9" }));
  expect(screen.queryByTestId("tree-panel-managekin")).toBeNull();
});

it("Add parent/child/sibling/partner open the Add modal anchored on the person (and close the panel)", () => {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  renderPanel(node({ personId: "x" }), { onAdd, onClose });

  screen.getByTestId("tree-panel-addparent").click();
  expect(onAdd).toHaveBeenLastCalledWith("x", "parent");
  expect(onClose).toHaveBeenCalled();

  screen.getByTestId("tree-panel-addchild").click();
  expect(onAdd).toHaveBeenLastCalledWith("x", "child");
  screen.getByTestId("tree-panel-addsibling").click();
  expect(onAdd).toHaveBeenLastCalledWith("x", "sibling");
  screen.getByTestId("tree-panel-addpartner").click();
  expect(onAdd).toHaveBeenLastCalledWith("x", "partner");
});

it("never re-roots — there is no 'Center tree here' control", () => {
  renderPanel(node({ personId: "x" }));
  expect(screen.queryByTestId("tree-panel-recenter")).toBeNull();
});

it("shows the relation-to-viewer label passed in as relationToViewer", () => {
  renderPanel(node({ personId: "x" }), { relationToViewer: "child" });
  expect(screen.getByTestId("tree-person-panel").textContent).toContain(hub.kin.relationLabel.child);
});

it("omits the relation line for the viewer's own node ('self') and when unresolvable (null)", () => {
  renderPanel(node({ personId: "v" }), { relationToViewer: "self" });
  const selfText = screen.getByTestId("tree-person-panel").textContent ?? "";
  expect(selfText).not.toContain("You");
  cleanup();
  renderPanel(node({ personId: "d", relationToRoot: "cousin" }), { relationToViewer: null });
  const nullText = screen.getByTestId("tree-person-panel").textContent ?? "";
  expect(nullText).not.toContain(hub.kin.relationLabel.cousin);
});

it("renders 'Unknown <relation>' for an anonymous bridge person", () => {
  renderPanel(
    node({ personId: "p-anon", displayName: null, identified: false, relationToRoot: "grandparent" }),
    { relationToViewer: null },
  );
  expect(screen.getByTestId("tree-person-panel").textContent).toContain("Unknown grandparent");
});

it("calls onClose when the close control is pressed", () => {
  const onClose = vi.fn();
  renderPanel(node({ personId: "p9" }), { onClose });
  screen.getByTestId("tree-panel-close").click();
  expect(onClose).toHaveBeenCalledOnce();
});
