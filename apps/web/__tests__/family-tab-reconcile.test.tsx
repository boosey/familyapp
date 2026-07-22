// @vitest-environment jsdom
/**
 * #337 — FamilyTab success wiring: toast, List highlight, Tree `?anchor=` push + refresh.
 * TreeCanvas / ReconcileFlow are stubbed so we exercise FamilyTab's orchestration only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { KinshipTreeData } from "@chronicle/core";
import { hub } from "@/app/_copy";
import type { FamilyListPerson } from "@/lib/family-list-people";

const push = vi.fn();
const refresh = vi.fn();
let searchParams = new URLSearchParams("tab=family&view=list");

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh,
  }),
  usePathname: () => "/hub",
  useSearchParams: () => searchParams,
}));

vi.mock("@/app/_kindred/useIsCompact", () => ({ useIsCompact: () => false }));

vi.mock("@/app/hub/tree/tree-canvas", () => ({
  TreeCanvas: ({
    reconcile,
  }: {
    reconcile?: { onReconcile: (personId: string) => void };
  }) => (
    <button
      type="button"
      data-testid="mock-tree-open-reconcile"
      onClick={() => reconcile?.onReconcile("mia-mention")}
    />
  ),
}));

vi.mock("@/app/hub/kin/reconcile-flow", () => ({
  ReconcileFlow: ({ onSuccess }: { onSuccess: (accountPersonId: string) => void }) => (
    <button
      type="button"
      data-testid="mock-reconcile-succeed"
      onClick={() => onSuccess("mia-real")}
    />
  ),
}));

import { FamilyTab } from "@/app/hub/tabs/FamilyTab";

const TREE: KinshipTreeData = { familyId: "F", rootPersonId: "p1", nodes: [], edges: [] };

function person(over: Partial<FamilyListPerson> & { personId: string }): FamilyListPerson {
  return {
    personId: over.personId,
    displayName: "displayName" in over ? (over.displayName ?? null) : over.personId,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    membership: over.membership ?? "member",
    relation: "relation" in over ? (over.relation ?? null) : null,
    birthYear: over.birthYear ?? null,
    deathYear: over.deathYear ?? null,
    sex: over.sex ?? "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
    reconcileSide: "reconcileSide" in over ? (over.reconcileSide ?? null) : null,
  };
}

const LIST_PEOPLE: FamilyListPerson[] = [
  person({
    personId: "mia-mention",
    displayName: "Mia",
    membership: "tree-only",
    reconcileSide: "mention",
    relation: "child",
  }),
  person({
    personId: "mia-real",
    displayName: "Mia Real",
    membership: "member",
    reconcileSide: "member",
  }),
];

afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
  searchParams = new URLSearchParams("tab=family&view=list");
});

describe("FamilyTab reconcile success (#337)", () => {
  it("on List: toasts and highlights the winner after success", () => {
    searchParams = new URLSearchParams("tab=family&view=list");
    render(
      <FamilyTab
        familyId="F"
        focusPersonId="p1"
        viewerPersonId="p1"
        tree={TREE}
        listPeople={LIST_PEOPLE}
        view="list"
        viewerIsSteward
        surface={{ active: "list", familiesParam: null, showRequests: false }}
      />,
    );

    fireEvent.click(screen.getByTestId("family-list-kebab-mia-mention"));
    fireEvent.click(screen.getByTestId("family-list-reconcile-mia-mention"));
    fireEvent.click(screen.getByTestId("mock-reconcile-succeed"));

    expect(screen.getByTestId("reconcile-toast").textContent).toBe(
      hub.reconcile.successToast("Mia Real"),
    );
    const winner = screen.getByTestId("family-list-row-mia-real");
    expect((winner.closest("li") ?? winner).getAttribute("data-highlighted")).toBe("true");
    expect(push).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("on Tree: pushes ?anchor=winner when the winner is not already focused", () => {
    searchParams = new URLSearchParams("tab=family&view=tree&anchor=other");
    render(
      <FamilyTab
        familyId="F"
        focusPersonId="other"
        viewerPersonId="p1"
        tree={TREE}
        listPeople={LIST_PEOPLE}
        view="tree"
        viewerIsSteward
        surface={{ active: "tree", familiesParam: null, showRequests: false }}
      />,
    );

    fireEvent.click(screen.getByTestId("mock-tree-open-reconcile"));
    fireEvent.click(screen.getByTestId("mock-reconcile-succeed"));

    expect(screen.getByTestId("reconcile-toast").textContent).toBe(
      hub.reconcile.successToast("Mia Real"),
    );
    expect(push).toHaveBeenCalledWith("/hub?tab=family&view=tree&anchor=mia-real");
    expect(refresh).toHaveBeenCalled();
  });

  it("on Tree: refreshes without push when the winner is already the anchor", () => {
    searchParams = new URLSearchParams("tab=family&view=tree&anchor=mia-real");
    render(
      <FamilyTab
        familyId="F"
        focusPersonId="mia-real"
        viewerPersonId="p1"
        tree={TREE}
        listPeople={LIST_PEOPLE}
        view="tree"
        viewerIsSteward
        surface={{ active: "tree", familiesParam: null, showRequests: false }}
      />,
    );

    fireEvent.click(screen.getByTestId("mock-tree-open-reconcile"));
    fireEvent.click(screen.getByTestId("mock-reconcile-succeed"));

    expect(push).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});
