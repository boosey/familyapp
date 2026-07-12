// @vitest-environment jsdom
/**
 * PersonPanel — read-only tap detail (pedigree-nav redesign). The panel links out to Stories, Manage
 * kin, and the four "Add parent/child/sibling/partner" targets (anchored on the selected person). Its
 * one non-navigational action is "Center tree here" — the ONLY re-root trigger — which calls
 * `onRecenter` and is HIDDEN when the person is already the focal root.
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
    sex: over.sex ?? "unknown",
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
    <PersonPanel node={node({ personId: "p9" })} isRoot={false} familyId="fam-1" viewerPersonId="v" onRecenter={() => {}} onClose={() => {}} />,
  );
  expect(hrefOf("tree-panel-stories")).toBe("/hub/about/p9");
  expect(hrefOf("tree-panel-managekin")).toBe("/hub/kin?scope=fam-1");
});

it("shows Add parent/child/sibling/partner anchored on the selected person", () => {
  render(
    <PersonPanel node={node({ personId: "x" })} isRoot={false} familyId="F" viewerPersonId="v" onRecenter={() => {}} onClose={() => {}} />,
  );
  expect(hrefOf("tree-panel-addparent")).toBe("/hub/kin?scope=F&anchor=x&relation=parent");
  expect(hrefOf("tree-panel-addchild")).toBe("/hub/kin?scope=F&anchor=x&relation=child");
  expect(hrefOf("tree-panel-addsibling")).toBe("/hub/kin?scope=F&anchor=x&relation=sibling");
  expect(hrefOf("tree-panel-addpartner")).toBe("/hub/kin?scope=F&anchor=x&relation=partner");
  expect(screen.getByText(hub.tree.panelAddParent)).toBeTruthy();
  expect(screen.getByText(hub.tree.panelAddChild)).toBeTruthy();
  expect(screen.getByText(hub.tree.panelAddSibling)).toBeTruthy();
  expect(screen.getByText(hub.tree.addPartner)).toBeTruthy();
});

it("shows 'Center tree here' for a non-root person and calls onRecenter with their id", () => {
  const onRecenter = vi.fn();
  render(
    <PersonPanel node={node({ personId: "x" })} isRoot={false} familyId="F" viewerPersonId="v" onRecenter={onRecenter} onClose={() => {}} />,
  );
  const btn = screen.getByTestId("tree-panel-recenter");
  expect(btn.textContent).toContain(hub.tree.centerHere);
  btn.click();
  expect(onRecenter).toHaveBeenCalledWith("x");
});

it("hides 'Center tree here' when the person is already the focal root", () => {
  render(
    <PersonPanel node={node({ personId: "x", relationToRoot: "self" })} isRoot familyId="F" viewerPersonId="v" onRecenter={() => {}} onClose={() => {}} />,
  );
  expect(screen.queryByTestId("tree-panel-recenter")).toBeNull();
});

it("labels the viewer's own node 'You' via viewerPersonId", () => {
  render(
    <PersonPanel node={node({ personId: "v" })} isRoot={false} familyId="fam-1" viewerPersonId="v" onRecenter={() => {}} onClose={() => {}} />,
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
      onRecenter={() => {}}
      onClose={() => {}}
    />,
  );
  expect(screen.getByTestId("tree-person-panel").textContent).toContain("Unknown grandparent");
});

it("calls onClose when the close control is pressed", () => {
  const onClose = vi.fn();
  render(
    <PersonPanel node={node({ personId: "p9" })} isRoot={false} familyId="fam-1" viewerPersonId="v" onRecenter={() => {}} onClose={onClose} />,
  );
  screen.getByTestId("tree-panel-close").click();
  expect(onClose).toHaveBeenCalledOnce();
});
