// @vitest-environment jsdom
/**
 * PersonPanel — read-only detail panel (ego-centric redesign, spec §2). It NEVER re-roots (the old
 * "Center tree here" action is gone) and never writes. It shows the relation-to-VIEWER (passed in as
 * `relationToViewer`, derived client-side by the canvas since the tree is focus-rooted) and links out to
 * Stories, Manage kin, and the four "Add parent/child/sibling/partner" targets (anchored on the person).
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { hub } from "@/app/_copy";
import type { TreeNode } from "@chronicle/core";
import { PersonPanel } from "@/app/hub/tree/person-panel";

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

function hrefOf(testId: string): string | null {
  const el = screen.getByTestId(testId);
  const anchor = el.tagName === "A" ? el : el.closest("a");
  return anchor?.getAttribute("href") ?? null;
}

it("links Stories and Manage kin to the right routes", () => {
  render(<PersonPanel node={node({ personId: "p9" })} familyId="fam-1" relationToViewer="child" onClose={() => {}} />);
  expect(hrefOf("tree-panel-stories")).toBe("/hub/about/p9");
  expect(hrefOf("tree-panel-managekin")).toBe("/hub/kin?scope=fam-1");
});

it("shows Add parent/child/sibling/partner anchored on the selected person", () => {
  render(<PersonPanel node={node({ personId: "x" })} familyId="F" relationToViewer="child" onClose={() => {}} />);
  expect(hrefOf("tree-panel-addparent")).toBe("/hub/kin?scope=F&anchor=x&relation=parent");
  expect(hrefOf("tree-panel-addchild")).toBe("/hub/kin?scope=F&anchor=x&relation=child");
  expect(hrefOf("tree-panel-addsibling")).toBe("/hub/kin?scope=F&anchor=x&relation=sibling");
  expect(hrefOf("tree-panel-addpartner")).toBe("/hub/kin?scope=F&anchor=x&relation=partner");
});

it("never re-roots — there is no 'Center tree here' control", () => {
  render(<PersonPanel node={node({ personId: "x" })} familyId="F" relationToViewer="child" onClose={() => {}} />);
  expect(screen.queryByTestId("tree-panel-recenter")).toBeNull();
});

it("shows the relation-to-viewer label passed in as relationToViewer", () => {
  render(<PersonPanel node={node({ personId: "x" })} familyId="F" relationToViewer="child" onClose={() => {}} />);
  expect(screen.getByTestId("tree-person-panel").textContent).toContain(hub.kin.relationLabel.child);
});

it("omits the relation line for the viewer's own node ('self') and when unresolvable (null)", () => {
  render(<PersonPanel node={node({ personId: "v" })} familyId="F" relationToViewer="self" onClose={() => {}} />);
  const selfText = screen.getByTestId("tree-person-panel").textContent ?? "";
  expect(selfText).not.toContain("You");
  cleanup();
  // A distant focus: viewer not in the loaded projection ⇒ null ⇒ no relation label.
  render(<PersonPanel node={node({ personId: "d", relationToRoot: "cousin" })} familyId="F" relationToViewer={null} onClose={() => {}} />);
  const nullText = screen.getByTestId("tree-person-panel").textContent ?? "";
  expect(nullText).not.toContain(hub.kin.relationLabel.cousin);
});

it("renders 'Unknown <relation>' for an anonymous bridge person", () => {
  render(
    <PersonPanel
      node={node({ personId: "p-anon", displayName: null, identified: false, relationToRoot: "grandparent" })}
      familyId="fam-1"
      relationToViewer={null}
      onClose={() => {}}
    />,
  );
  expect(screen.getByTestId("tree-person-panel").textContent).toContain("Unknown grandparent");
});

it("calls onClose when the close control is pressed", () => {
  const onClose = vi.fn();
  render(<PersonPanel node={node({ personId: "p9" })} familyId="fam-1" relationToViewer="child" onClose={onClose} />);
  screen.getByTestId("tree-panel-close").click();
  expect(onClose).toHaveBeenCalledOnce();
});
