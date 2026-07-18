// @vitest-environment jsdom
/**
 * #161 (ADR-0023) unplaced-members web tests — RENDER + WIRING (the data correctness is core-tested).
 *
 *   1. Unplaced members supplied by the core read render as rows in the List view AND as not-yet-
 *      connected tray cards in the Tree view (both surfaces, per ADR-0023).
 *   2. The three per-member actions are present and invoke the right (stubbed) server action:
 *      place-in-tree opens the link modal and calls linkExistingMember; "Not family" calls
 *      setMemberNonFamily(true); steward "Remove" requires an in-page confirm then calls endMembership.
 *   3. Remove is steward-only (hidden for a non-steward viewer). No native confirm() is used.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { KinshipTreeData, TreeNode, UnplacedMember } from "@chronicle/core";
import { UnplacedMembers } from "./UnplacedMembers";
import { FamilyTab } from "./FamilyTab";

// next/navigation — the panel calls router.refresh() after a successful action; FamilyTab's
// FamilyChips also reads usePathname/useSearchParams, so the mock supplies all three.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/hub",
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => {
  cleanup();
  refresh.mockReset();
});

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? over.personId,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    birthYear: null,
    deathYear: null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: over.sex ?? "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
  };
}

const MEMBERS: UnplacedMember[] = [
  { personId: "u1", displayName: "Rosa Esposito", role: "member" },
  { personId: "u2", displayName: "Marco Ricci", role: "member" },
];

const ANCHORS = [
  { id: "self", name: "You" },
  { id: "elena", name: "Elena" },
];

const okAction = async () => ({ ok: true as const });

function renderPanel(over: Partial<React.ComponentProps<typeof UnplacedMembers>> = {}) {
  const onLink = over.onLink ?? vi.fn(okAction);
  const onSetNonFamily = over.onSetNonFamily ?? vi.fn(okAction);
  const onEndMembership = over.onEndMembership ?? vi.fn(okAction);
  render(
    <UnplacedMembers
      familyId="F"
      members={MEMBERS}
      anchors={ANCHORS}
      viewerIsSteward={over.viewerIsSteward ?? false}
      variant={over.variant ?? "section"}
      onLink={onLink}
      onSetNonFamily={onSetNonFamily}
      onEndMembership={onEndMembership}
    />,
  );
  return { onLink, onSetNonFamily, onEndMembership };
}

/* ── 1. Both surfaces render the unplaced members ─────────────────────────────── */

function treeData(): KinshipTreeData {
  return {
    familyId: "F",
    rootPersonId: "self",
    nodes: [node({ personId: "self", displayName: "You", relationToRoot: "self" })],
    edges: [],
  };
}

it("renders unplaced members as rows in the List view", () => {
  render(
    <FamilyTab
      familyId="F"
      focusPersonId="self"
      viewerPersonId="self"
      tree={treeData()}
      kin={[]}
      unplaced={MEMBERS}
      viewerIsSteward={false}
      view="list"
    />,
  );
  const panel = screen.getByTestId("unplaced-members");
  expect(within(panel).getByTestId("unplaced-row-u1")).toBeTruthy();
  expect(within(panel).getByTestId("unplaced-row-u2")).toBeTruthy();
  expect(panel.textContent).toContain("Rosa Esposito");
});

it("renders unplaced members as a not-yet-connected tray in the Tree view", () => {
  render(
    <FamilyTab
      familyId="F"
      focusPersonId="self"
      viewerPersonId="self"
      tree={treeData()}
      kin={[]}
      unplaced={MEMBERS}
      viewerIsSteward={false}
      view="tree"
    />,
  );
  // The tray is present in the tree view (variant "tray" adds the section testid) and lists the members.
  const tray = screen.getByTestId("unplaced-members");
  expect(within(tray).getByTestId("unplaced-row-u1")).toBeTruthy();
  // It sits OUTSIDE the pan/zoom layer (the layout engine) — the tray is not inside tree-pan-layer.
  const panLayer = screen.getByTestId("tree-pan-layer");
  expect(panLayer.contains(tray)).toBe(false);
});

/* ── 2. Actions invoke the right handler ──────────────────────────────────────── */

it("place-in-tree opens the link modal and calls linkExistingMember with anchor + relation", async () => {
  const { onLink } = renderPanel();
  act(() => screen.getByTestId("unplaced-place-u1").click());

  // Modal open with the two pickers.
  expect(screen.getByTestId("place-member-modal")).toBeTruthy();
  const anchor = screen.getByTestId("place-member-anchor") as HTMLSelectElement;
  const relation = screen.getByTestId("place-member-relation") as HTMLSelectElement;
  fireEvent.change(anchor, { target: { value: "elena" } });
  fireEvent.change(relation, { target: { value: "child" } });

  await act(async () => {
    fireEvent.submit(screen.getByTestId("place-member-submit").closest("form")!);
  });

  expect(onLink).toHaveBeenCalledTimes(1);
  expect(onLink).toHaveBeenCalledWith("F", "u1", "child", "elena");
});

it("'Not family' calls setMemberNonFamily(true) and offers a Move-back undo", async () => {
  const { onSetNonFamily } = renderPanel();
  await act(async () => {
    screen.getByTestId("unplaced-nonfamily-u1").click();
  });
  expect(onSetNonFamily).toHaveBeenCalledWith("F", "u1", true);
  // The member moves to the set-aside sub-list with a restore control.
  expect(screen.getByTestId("unplaced-restore-u1")).toBeTruthy();
});

it("steward Remove requires an in-page confirm, then calls endMembership (no native confirm)", async () => {
  const confirmSpy = vi.spyOn(window, "confirm");
  const { onEndMembership } = renderPanel({ viewerIsSteward: true });

  // First tap arms the in-page confirm (does NOT call the action yet).
  act(() => screen.getByTestId("unplaced-remove-u1").click());
  expect(onEndMembership).not.toHaveBeenCalled();
  expect(confirmSpy).not.toHaveBeenCalled();

  // Confirm tap fires the action.
  await act(async () => {
    screen.getByTestId("unplaced-remove-confirm-u1").click();
  });
  expect(onEndMembership).toHaveBeenCalledWith("F", "u1");
  expect(confirmSpy).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

/* ── 3. Remove is steward-only ────────────────────────────────────────────────── */

it("hides the Remove action for a non-steward viewer", () => {
  renderPanel({ viewerIsSteward: false });
  expect(screen.queryByTestId("unplaced-remove-u1")).toBeNull();
  // But place + non-family are always available to any active member.
  expect(screen.getByTestId("unplaced-place-u1")).toBeTruthy();
  expect(screen.getByTestId("unplaced-nonfamily-u1")).toBeTruthy();
});

it("renders nothing when there are no unplaced members", () => {
  render(
    <UnplacedMembers
      familyId="F"
      members={[]}
      anchors={ANCHORS}
      viewerIsSteward
    />,
  );
  expect(screen.queryByTestId("unplaced-members")).toBeNull();
});
