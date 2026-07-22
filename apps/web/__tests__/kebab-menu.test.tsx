// @vitest-environment jsdom
/**
 * KebabMenu — the shared ⋮ add-relative menu (pedigree-nav redesign, spec §Testing). Verifies the
 * adjacency gating (parent hidden at ≥2; partner always shown — multi-partner allowed; child/sibling
 * always) and that each
 * visible item opens the tree's Add modal (via TreeAddProvider) anchored on the node with the right
 * relation — /hub/kin navigation is gone (2026-07-14).
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { KebabMenu } from "@/app/hub/tree/kebab-menu";
import { TreeCallbacksProvider, type OpenAddRelative } from "@/app/hub/tree/tree-callbacks-context";

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
    inviteStatus: over.inviteStatus ?? "not-applicable",
  };
}

/** Render the menu inside a capturing provider and open it (items only exist once open). */
function open(props: { parentCount: number; partnerCount: number; personId?: string; onAdd?: OpenAddRelative }) {
  render(
    <TreeCallbacksProvider
      value={{
        openAdd: props.onAdd ?? (() => {}),
        focusPerson: () => {},
        invitePerson: () => {},
        reconcilePerson: () => {},
      }}
    >
      <KebabMenu
        node={node({ personId: props.personId ?? "n1" })}
        parentCount={props.parentCount}
        partnerCount={props.partnerCount}
      />
    </TreeCallbacksProvider>,
  );
  act(() => {
    screen.getByTestId("tree-kebab-trigger").click();
  });
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

it("always shows Add partner (multi-partner allowed), even when partnerCount ≥ 1", () => {
  open({ parentCount: 0, partnerCount: 0 });
  expect(screen.getByTestId("tree-kebab-addpartner")).toBeTruthy();
  cleanup();
  open({ parentCount: 0, partnerCount: 1 });
  expect(screen.getByTestId("tree-kebab-addpartner")).toBeTruthy();
  cleanup();
  open({ parentCount: 0, partnerCount: 2 });
  expect(screen.getByTestId("tree-kebab-addpartner")).toBeTruthy();
});

it("opens the Add modal anchored on the node with the right relation per item", () => {
  const onAdd = vi.fn();
  open({ parentCount: 0, partnerCount: 0, personId: "px", onAdd });

  act(() => screen.getByTestId("tree-kebab-addchild").click());
  expect(onAdd).toHaveBeenLastCalledWith("px", "child");

  // Menu closes on select — reopen for the next item.
  act(() => screen.getByTestId("tree-kebab-trigger").click());
  act(() => screen.getByTestId("tree-kebab-addparent").click());
  expect(onAdd).toHaveBeenLastCalledWith("px", "parent");
});

it("labels the trigger neutrally (not as any single add action)", () => {
  render(<KebabMenu node={node({ personId: "n1" })} parentCount={0} partnerCount={0} />);
  const trigger = screen.getByTestId("tree-kebab-trigger");
  expect(trigger.getAttribute("aria-label")).toBe(hub.tree.moreActions);
});
