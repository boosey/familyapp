// @vitest-environment jsdom
/**
 * #337 — KinList steward Reconciliation row ⋮. Shows **This is the same person as…** only for
 * stewards when complementary candidates exist; never for placeholders / non-stewards / empty pickers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hub } from "@/app/_copy";
import type { FamilyListPerson } from "@/lib/family-list-people";
import { KinList } from "@/app/hub/tabs/KinList";

afterEach(cleanup);

function person(over: Partial<FamilyListPerson> & { personId: string }): FamilyListPerson {
  return {
    personId: over.personId,
    displayName: "displayName" in over ? (over.displayName ?? null) : over.personId,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    membership: over.membership ?? "member",
    relation: "relation" in over ? (over.relation ?? null) : "parent",
    birthYear: over.birthYear ?? null,
    deathYear: over.deathYear ?? null,
    sex: over.sex ?? "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
    reconcileSide: "reconcileSide" in over ? (over.reconcileSide ?? null) : null,
    isSteward: over.isSteward ?? false,
  };
}

const MENTION = person({
  personId: "mia-mention",
  displayName: "Mia",
  membership: "tree-only",
  reconcileSide: "mention",
  relation: "child",
});
const MEMBER = person({
  personId: "mia-real",
  displayName: "Mia Real",
  membership: "member",
  reconcileSide: "member",
  relation: null,
});
const PLACEHOLDER = person({
  personId: "bridge",
  displayName: null,
  identified: false,
  membership: "tree-only",
  reconcileSide: null,
  relation: "parent",
});

describe("KinList reconcile (#337)", () => {
  it("shows the reconcile ⋮ for a steward when complementary candidates exist", () => {
    const onReconcile = vi.fn();
    render(
      <KinList
        people={[MENTION, MEMBER]}
        viewerIsSteward
        onReconcile={onReconcile}
      />,
    );
    expect(screen.getByTestId("family-list-kebab-mia-mention")).toBeTruthy();
    expect(screen.getByTestId("family-list-kebab-mia-real")).toBeTruthy();
    fireEvent.click(screen.getByTestId("family-list-kebab-mia-mention"));
    expect(screen.getByTestId("family-list-reconcile-mia-mention").textContent).toBe(
      hub.reconcile.action,
    );
    fireEvent.click(screen.getByTestId("family-list-reconcile-mia-mention"));
    expect(onReconcile).toHaveBeenCalledWith("mia-mention");
  });

  it("hides the action for a non-steward", () => {
    render(
      <KinList
        people={[MENTION, MEMBER]}
        viewerIsSteward={false}
        onReconcile={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("family-list-kebab-mia-mention")).toBeNull();
  });

  it("hides the action when the complementary picker would be empty (H+)", () => {
    render(
      <KinList
        people={[MENTION, PLACEHOLDER]}
        viewerIsSteward
        onReconcile={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("family-list-kebab-mia-mention")).toBeNull();
  });

  it("never offers reconcile on a placeholder row", () => {
    render(
      <KinList
        people={[PLACEHOLDER, MEMBER]}
        viewerIsSteward
        onReconcile={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("family-list-kebab-bridge")).toBeNull();
  });

  it("clears an active search when highlighting the winner so focus is visible", () => {
    const { rerender } = render(
      <KinList people={[MENTION, MEMBER]} viewerIsSteward onReconcile={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("searchbox", { name: hub.kin.searchAria }), {
      target: { value: "Mia" },
    });
    // "Mia" matches the mention; "Mia Real" also matches "Mia" — use a query that hides the member.
    fireEvent.change(screen.getByRole("searchbox", { name: hub.kin.searchAria }), {
      target: { value: "mia-mention-only" },
    });
    // Neither display name matches that nonsense query.
    expect(screen.queryByTestId("family-list-row-mia-real")).toBeNull();

    rerender(
      <KinList
        people={[MENTION, MEMBER]}
        viewerIsSteward
        onReconcile={vi.fn()}
        highlightedPersonId="mia-real"
      />,
    );
    const winner = screen.getByTestId("family-list-row-mia-real");
    expect(winner.closest("[data-highlighted='true']") ?? winner).toBeTruthy();
    expect(
      (winner.closest("li") ?? winner).getAttribute("data-highlighted"),
    ).toBe("true");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });
});
