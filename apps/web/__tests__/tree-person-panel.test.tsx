// @vitest-environment jsdom
/**
 * PersonPanel — read-only tap detail (spec §7). The three navigational actions must point at the
 * right routes; "Center tree here" is hidden for the root (you can't re-center on yourself). No writes.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  };
}

function hrefOf(testId: string): string | null {
  // The Link wraps the button; find the anchor ancestor.
  const el = screen.getByTestId(testId);
  const anchor = el.tagName === "A" ? el : el.closest("a");
  return anchor?.getAttribute("href") ?? null;
}

it("links the three actions to the right routes for a non-root person", () => {
  render(<PersonPanel node={node({ personId: "p9" })} isRoot={false} familyId="fam-1" onClose={() => {}} />);
  expect(hrefOf("tree-panel-stories")).toBe("/hub/about/p9");
  expect(hrefOf("tree-panel-center")).toBe("/hub/tree?scope=fam-1&root=p9");
  expect(hrefOf("tree-panel-managekin")).toBe("/hub/kin?scope=fam-1");
});

it("hides 'Center tree here' when the person is the root", () => {
  render(
    <PersonPanel node={node({ personId: "p-self", relationToRoot: "self" })} isRoot familyId="fam-1" onClose={() => {}} />,
  );
  expect(screen.queryByTestId("tree-panel-center")).toBeNull();
  expect(screen.getByTestId("tree-panel-stories")).toBeTruthy();
});

it("renders 'Unknown <relation>' for an anonymous bridge person", () => {
  render(
    <PersonPanel
      node={node({ personId: "p-anon", displayName: null, identified: false, relationToRoot: "grandparent" })}
      isRoot={false}
      familyId="fam-1"
      onClose={() => {}}
    />,
  );
  expect(screen.getByTestId("tree-person-panel").textContent).toContain("Unknown grandparent");
});

it("calls onClose when the close control is pressed", () => {
  const onClose = vi.fn();
  render(<PersonPanel node={node({ personId: "p9" })} isRoot={false} familyId="fam-1" onClose={onClose} />);
  screen.getByTestId("tree-panel-close").click();
  expect(onClose).toHaveBeenCalledOnce();
});
