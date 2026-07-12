// @vitest-environment jsdom
/**
 * KebabMenu — the shared ⋮ add-relative menu (pedigree-nav redesign, spec §Testing). Verifies the
 * adjacency gating (parent hidden at ≥2, partner hidden at ≥1; child/sibling always) and that each
 * visible item targets the /hub/kin add flow anchored on the node with the right relation.
 */
import { afterEach, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { KebabMenu } from "@/app/hub/tree/kebab-menu";

afterEach(cleanup);

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? "Marco",
    identified: true,
    lifeStatus: "living",
    birthYear: null,
    deathYear: null,
    relationToRoot: null,
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: "unknown",
  };
}

/** Render the menu and open it (items only exist once open). */
function open(props: { parentCount: number; partnerCount: number; familyId?: string; personId?: string }) {
  render(
    <KebabMenu
      node={node({ personId: props.personId ?? "n1" })}
      familyId={props.familyId ?? "F"}
      parentCount={props.parentCount}
      partnerCount={props.partnerCount}
    />,
  );
  act(() => {
    screen.getByTestId("tree-kebab-trigger").click();
  });
}

function hrefOf(testId: string): string | null {
  return screen.getByTestId(testId).getAttribute("href");
}

it("always shows Add child and Add sibling", () => {
  open({ parentCount: 2, partnerCount: 1 });
  expect(screen.getByTestId("tree-kebab-addchild")).toBeTruthy();
  expect(screen.getByTestId("tree-kebab-addsibling")).toBeTruthy();
});

it("shows Add parent only when parentCount < 2", () => {
  open({ parentCount: 1, partnerCount: 0 });
  expect(screen.getByTestId("tree-kebab-addparent")).toBeTruthy();
  cleanup();
  open({ parentCount: 2, partnerCount: 0 });
  expect(screen.queryByTestId("tree-kebab-addparent")).toBeNull();
});

it("shows Add partner only when partnerCount === 0", () => {
  open({ parentCount: 0, partnerCount: 0 });
  expect(screen.getByTestId("tree-kebab-addpartner")).toBeTruthy();
  cleanup();
  open({ parentCount: 0, partnerCount: 1 });
  expect(screen.queryByTestId("tree-kebab-addpartner")).toBeNull();
});

it("targets /hub/kin with the right scope, anchor, and relation per item", () => {
  open({ parentCount: 0, partnerCount: 0, familyId: "fam-9", personId: "px" });
  expect(hrefOf("tree-kebab-addchild")).toBe("/hub/kin?scope=fam-9&anchor=px&relation=child");
  expect(hrefOf("tree-kebab-addsibling")).toBe("/hub/kin?scope=fam-9&anchor=px&relation=sibling");
  expect(hrefOf("tree-kebab-addparent")).toBe("/hub/kin?scope=fam-9&anchor=px&relation=parent");
  expect(hrefOf("tree-kebab-addpartner")).toBe("/hub/kin?scope=fam-9&anchor=px&relation=partner");
});

it("labels the trigger neutrally (not as any single add action)", () => {
  render(<KebabMenu node={node({ personId: "n1" })} familyId="F" parentCount={0} partnerCount={0} />);
  const trigger = screen.getByTestId("tree-kebab-trigger");
  expect(trigger.getAttribute("aria-label")).toBe(hub.tree.moreActions);
});
