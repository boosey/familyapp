// @vitest-environment jsdom
/**
 * Tree Slice D (#6) invite-affordance tests:
 *   1. PersonDetails shows the Invite button ONLY for `invitable`; the muted "pending" note for
 *      `pending`; nothing for `accepted`/`not-applicable`. Clicking Invite calls the ONE handler.
 *   2. KebabMenu shows the Invite… item ONLY for `invitable`, and it calls the invite context handler
 *      (the SAME handler the sheet uses).
 *   3. From TreeCanvas, inviting deep-links to the EXISTING invite flow pre-targeted at this
 *      person + family (`/hub?tab=invite&families=<familyId>&inviteeName=<name>`) — no new invite logic;
 *      the target flow's form still posts to `createInvitation`.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { PersonDetails } from "./person-details";
import { KebabMenu } from "./kebab-menu";
import { TreeInviteProvider } from "./invite-context";
import { TreeCanvas } from "./tree-canvas";
import type { PersonEditabilityResult } from "./actions";

afterEach(cleanup);

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? "Rosa",
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

/** The editability probe resolves not-editable (so the read-only view renders, no Edit button noise). */
const notEditable = async (): Promise<PersonEditabilityResult> => ({ ok: true, editable: false });

/* ── 1. PersonDetails ──────────────────────────────────────────────────────── */

it("PersonDetails shows the Invite button only for an invitable person", () => {
  const onInvite = vi.fn();
  render(
    <PersonDetails
      node={node({ personId: "p1", inviteStatus: "invitable" })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      onInvite={onInvite}
      checkEditable={notEditable}
    />,
  );
  const btn = screen.getByTestId("tree-details-invite");
  expect(btn.textContent).toBe(hub.tree.inviteButton);
  act(() => btn.click());
  expect(onInvite).toHaveBeenCalledTimes(1);
  expect(onInvite.mock.calls[0]![0].personId).toBe("p1");
});

it("PersonDetails shows the muted pending note (and no button) for a pending person", () => {
  render(
    <PersonDetails
      node={node({ personId: "p2", inviteStatus: "pending" })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      onInvite={() => {}}
      checkEditable={notEditable}
    />,
  );
  expect(screen.getByTestId("tree-details-invite-pending").textContent).toBe(
    hub.tree.invitePendingNote,
  );
  expect(screen.queryByTestId("tree-details-invite")).toBeNull();
});

it("PersonDetails shows no invite affordance for accepted / not-applicable", () => {
  for (const status of ["accepted", "not-applicable"] as const) {
    render(
      <PersonDetails
        node={node({ personId: `p-${status}`, inviteStatus: status })}
        relationToViewer={null}
        familyId="F"
        onClose={() => {}}
        onInvite={() => {}}
        checkEditable={notEditable}
      />,
    );
    expect(screen.queryByTestId("tree-details-invite")).toBeNull();
    expect(screen.queryByTestId("tree-details-invite-pending")).toBeNull();
    cleanup();
  }
});

/* ── 2. KebabMenu ──────────────────────────────────────────────────────────── */

function openKebab(n: TreeNode, onInvite: (node: TreeNode) => void) {
  render(
    <TreeInviteProvider value={onInvite}>
      <KebabMenu node={n} parentCount={0} partnerCount={0} />
    </TreeInviteProvider>,
  );
  act(() => {
    screen.getByTestId("tree-kebab-trigger").click();
  });
}

it("KebabMenu shows Invite… only for an invitable person and calls the invite handler", () => {
  const onInvite = vi.fn();
  openKebab(node({ personId: "k1", inviteStatus: "invitable" }), onInvite);
  const item = screen.getByTestId("tree-kebab-invite");
  expect(item.textContent).toBe(hub.tree.kebabInvite);
  act(() => item.click());
  expect(onInvite).toHaveBeenCalledTimes(1);
  expect(onInvite.mock.calls[0]![0].personId).toBe("k1");
});

it("KebabMenu hides Invite… for pending / accepted / not-applicable", () => {
  for (const status of ["pending", "accepted", "not-applicable"] as const) {
    openKebab(node({ personId: `k-${status}`, inviteStatus: status }), () => {});
    expect(screen.queryByTestId("tree-kebab-invite")).toBeNull();
    cleanup();
  }
});

/* ── 3. TreeCanvas → existing invite flow, pre-targeted ─────────────────────── */

const FOCUS = "p-self";

function selfWithInvitableChild(): KinshipTreeData {
  return {
    familyId: "FAM-1",
    rootPersonId: FOCUS,
    nodes: [
      node({ personId: FOCUS, relationToRoot: "self" }),
      node({
        personId: "elena",
        displayName: "Elena Ricci",
        relationToRoot: "child",
        inviteStatus: "invitable",
      }),
    ],
    edges: [
      {
        edgeType: "parent_of",
        personAId: FOCUS,
        personBId: "elena",
        nature: "biological",
        state: "asserted",
        assertedBy: FOCUS,
        assertedAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
  };
}

it("inviting from the tree deep-links to the existing invite flow, pre-targeted at person + family", () => {
  const navigate = vi.fn();
  render(
    <TreeCanvas
      familyId="FAM-1"
      focusPersonId={FOCUS}
      viewerPersonId={FOCUS}
      initial={selfWithInvitableChild()}
      navigate={navigate}
    />,
  );

  // Open Elena's kebab and click Invite…
  const kebabs = screen.getAllByTestId("tree-kebab-trigger");
  // Trigger every kebab open, then click the invite item that appears (only Elena is invitable).
  for (const k of kebabs) act(() => fireEvent.click(k));
  const inviteItem = screen.getByTestId("tree-kebab-invite");
  act(() => fireEvent.click(inviteItem));

  expect(navigate).toHaveBeenCalledTimes(1);
  const url = navigate.mock.calls[0]![0] as string;
  const parsed = new URL(url, "https://example.test");
  expect(parsed.pathname).toBe("/hub");
  expect(parsed.searchParams.get("tab")).toBe("invite"); // the EXISTING invite flow
  expect(parsed.searchParams.get("families")).toBe("FAM-1"); // family pre-targeted
  expect(parsed.searchParams.get("inviteeName")).toBe("Elena Ricci"); // name pre-filled
});
