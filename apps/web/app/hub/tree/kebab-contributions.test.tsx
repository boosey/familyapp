// @vitest-environment jsdom
/**
 * Tree Slice B — the KebabMenu's three contribution items (Stories · Photos · Mentions), which sit
 * BEFORE Focus (final order: [Stories · Photos · Mentions · Focus] — [Add …]). They are Links to the
 * per-person page with the right ?section= (Links keep the menu mountable without a router context,
 * matching the tree's no-op-context discipline for standalone rendering).
 */
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { TreeNode } from "@chronicle/core";
import { KebabMenu } from "./kebab-menu";

afterEach(cleanup);

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? "Rosa",
    identified: true,
    lifeStatus: "living",
    birthYear: null,
    deathYear: null,
    relationToRoot: null,
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
  };
}

function openMenu() {
  fireEvent.click(screen.getByTestId("tree-kebab-trigger"));
  return screen.getByTestId("tree-kebab-menu");
}

it("links each contribution item to the per-person page section", () => {
  render(<KebabMenu node={node({ personId: "p1" })} parentCount={0} partnerCount={0} />);
  openMenu();

  expect(screen.getByTestId("tree-kebab-stories").getAttribute("href")).toBe(
    "/hub/person/p1?section=stories",
  );
  expect(screen.getByTestId("tree-kebab-photos").getAttribute("href")).toBe(
    "/hub/person/p1?section=photos",
  );
  expect(screen.getByTestId("tree-kebab-mentions").getAttribute("href")).toBe(
    "/hub/person/p1?section=mentions",
  );
});

it("orders the three contribution items BEFORE Focus", () => {
  render(<KebabMenu node={node({ personId: "p1" })} parentCount={0} partnerCount={0} />);
  const menu = openMenu();
  const items = within(menu).getAllByRole("menuitem");
  const testIds = items.map((el) => el.getAttribute("data-testid"));
  // Stories · Photos · Mentions · Focus, then the Add-* items.
  expect(testIds.slice(0, 4)).toEqual([
    "tree-kebab-stories",
    "tree-kebab-photos",
    "tree-kebab-mentions",
    "tree-kebab-focus",
  ]);
});

it("omits Focus (but keeps the three contribution items) on the focus card", () => {
  render(<KebabMenu node={node({ personId: "p1" })} parentCount={0} partnerCount={0} isFocus />);
  openMenu();
  expect(screen.queryByTestId("tree-kebab-focus")).toBeNull();
  expect(screen.getByTestId("tree-kebab-stories")).toBeTruthy();
  expect(screen.getByTestId("tree-kebab-mentions")).toBeTruthy();
});
