// @vitest-environment jsdom
/**
 * #337 — Tree kebab steward Reconciliation item. Gated like Invite: steward + complementary
 * candidates; hidden otherwise.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { KebabMenu } from "@/app/hub/tree/kebab-menu";
import { TreeReconcileProvider } from "@/app/hub/tree/reconcile-context";
import type { ReconcilePersonView } from "@/lib/reconcile-eligibility";

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

function rp(over: Partial<ReconcilePersonView> & { personId: string }): ReconcilePersonView {
  return {
    personId: over.personId,
    displayName: over.displayName ?? over.personId,
    identified: over.identified ?? true,
    isActiveMember: over.isActiveMember ?? false,
    hasAccount: over.hasAccount ?? false,
    isMention: over.isMention ?? false,
  };
}

const mention = rp({ personId: "mia-mention", displayName: "Mia", isMention: true });
const member = rp({
  personId: "mia-real",
  displayName: "Mia Real",
  isActiveMember: true,
  hasAccount: true,
});

function openMenu() {
  fireEvent.click(screen.getByTestId("tree-kebab-trigger"));
  return screen.getByTestId("tree-kebab-menu");
}

it("shows This is the same person as… for a steward when candidates exist", () => {
  const onReconcile = vi.fn();
  render(
    <TreeReconcileProvider value={onReconcile}>
      <KebabMenu
        node={node({ personId: "mia-mention" })}
        parentCount={0}
        partnerCount={0}
        reconcile={{
          viewerIsSteward: true,
          start: mention,
          pool: [mention, member],
        }}
      />
    </TreeReconcileProvider>,
  );
  openMenu();
  expect(screen.getByTestId("tree-kebab-reconcile").textContent).toBe(hub.reconcile.action);
  fireEvent.click(screen.getByTestId("tree-kebab-reconcile"));
  expect(onReconcile).toHaveBeenCalledWith("mia-mention");
});

it("hides the item for a non-steward", () => {
  render(
    <KebabMenu
      node={node({ personId: "mia-mention" })}
      parentCount={0}
      partnerCount={0}
      reconcile={{
        viewerIsSteward: false,
        start: mention,
        pool: [mention, member],
      }}
    />,
  );
  openMenu();
  expect(screen.queryByTestId("tree-kebab-reconcile")).toBeNull();
});

it("hides the item when the complementary picker would be empty", () => {
  render(
    <KebabMenu
      node={node({ personId: "mia-mention" })}
      parentCount={0}
      partnerCount={0}
      reconcile={{
        viewerIsSteward: true,
        start: mention,
        pool: [mention],
      }}
    />,
  );
  openMenu();
  expect(screen.queryByTestId("tree-kebab-reconcile")).toBeNull();
});
