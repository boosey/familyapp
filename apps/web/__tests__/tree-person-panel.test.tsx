// @vitest-environment jsdom
/**
 * PersonPanel — read-only tap detail (spec §7). The panel links out to Stories, Manage kin, and the
 * three "Add parent/child/sibling" targets (anchored on the selected person). No "Center" link. No writes.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
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
  };
}

function hrefOf(testId: string): string | null {
  // The Link wraps the button; find the anchor ancestor.
  const el = screen.getByTestId(testId);
  const anchor = el.tagName === "A" ? el : el.closest("a");
  return anchor?.getAttribute("href") ?? null;
}

it("links Stories and Manage kin to the right routes for a non-root person", () => {
  render(
    <PersonPanel node={node({ personId: "p9" })} isRoot={false} familyId="fam-1" viewerPersonId="v" onClose={() => {}} />,
  );
  expect(hrefOf("tree-panel-stories")).toBe("/hub/about/p9");
  expect(hrefOf("tree-panel-managekin")).toBe("/hub/kin?scope=fam-1");
});

it("shows Add parent/child/sibling anchored on the selected person and no 'Center tree here'", () => {
  render(
    <PersonPanel node={node({ personId: "x" })} isRoot={false} familyId="F" viewerPersonId="v" onClose={() => {}} />,
  );
  // The Center link is gone entirely.
  expect(screen.queryByTestId("tree-panel-center")).toBeNull();
  expect(hrefOf("tree-panel-addparent")).toBe("/hub/kin?scope=F&anchor=x&relation=parent");
  expect(hrefOf("tree-panel-addchild")).toBe("/hub/kin?scope=F&anchor=x&relation=child");
  expect(hrefOf("tree-panel-addsibling")).toBe("/hub/kin?scope=F&anchor=x&relation=sibling");
  expect(screen.getByText(hub.tree.panelAddParent)).toBeTruthy();
  expect(screen.getByText(hub.tree.panelAddChild)).toBeTruthy();
  expect(screen.getByText(hub.tree.panelAddSibling)).toBeTruthy();
});

it("labels the viewer's own node 'You' via viewerPersonId", () => {
  render(
    <PersonPanel node={node({ personId: "v" })} isRoot={false} familyId="fam-1" viewerPersonId="v" onClose={() => {}} />,
  );
  expect(screen.getByTestId("tree-person-panel").textContent).toContain(hub.tree.you);
});

it("renders 'Unknown <relation>' for an anonymous bridge person", () => {
  render(
    <PersonPanel
      node={node({ personId: "p-anon", displayName: null, identified: false, relationToRoot: "grandparent" })}
      isRoot={false}
      familyId="fam-1"
      viewerPersonId="v"
      onClose={() => {}}
    />,
  );
  expect(screen.getByTestId("tree-person-panel").textContent).toContain("Unknown grandparent");
});

it("calls onClose when the close control is pressed", () => {
  const onClose = vi.fn();
  render(
    <PersonPanel node={node({ personId: "p9" })} isRoot={false} familyId="fam-1" viewerPersonId="v" onClose={onClose} />,
  );
  screen.getByTestId("tree-panel-close").click();
  expect(onClose).toHaveBeenCalledOnce();
});
