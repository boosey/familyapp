// @vitest-environment jsdom
/**
 * Tree Slice D (#6) invite-affordance tests, extended for #334 (ADR-0028):
 *   1. PersonDetails shows the Invite button ONLY for `invitable`; the muted "pending" note for
 *      `pending`; nothing for `not-applicable`. Clicking Invite calls the ONE handler.
 *   2. KebabMenu shows the Invite… item ONLY for `invitable`, and it calls the invite context handler
 *      (the SAME handler the sheet uses).
 *   3. From TreeCanvas, BOTH the details-sheet Invite button and the per-card kebab's Invite… item open
 *      the SAME in-place `PersonInviteModal` (#334 AC 1/5) — the old `/hub?tab=invite&…` deep-link
 *      (`navigate`) is retired; `TreeCanvas` no longer even accepts a `navigate` prop for this path.
 *   4. A successful send through the modal leaves the details sheet mounted and open underneath it
 *      (#334 AC 4) — the modal never closes/replaces `PersonDetails`.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { KinshipTreeData, TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { PersonDetails } from "./person-details";
import { KebabMenu } from "./kebab-menu";
import { TreeCallbacksProvider } from "./tree-callbacks-context";
import { TreeCanvas } from "./tree-canvas";
import type { PersonEditabilityResult } from "./actions";
import type { PersonInviteFormState, PersonInviteTargetsResult } from "./person-invite-actions";

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
    membership: over.membership ?? "tree-only",
    isSteward: over.isSteward ?? false,
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
  // #372 — the standalone pending note was folded into the shared status row (glyph + line).
  expect(screen.getByTestId("tree-details-status").textContent).toContain(
    hub.tree.statusBadge.invitedLine,
  );
  expect(screen.queryByTestId("tree-details-invite")).toBeNull();
});

it("PersonDetails shows no invite affordance for not-applicable", () => {
  render(
    <PersonDetails
      node={node({ personId: "p-na", inviteStatus: "not-applicable" })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      onInvite={() => {}}
      checkEditable={notEditable}
    />,
  );
  expect(screen.queryByTestId("tree-details-invite")).toBeNull();
  // #372 — no cross-family Invite button for not-applicable; the standalone pending note is gone.
  // (This tree-only living person still shows an "eligible" status row — a different, in-family axis.)
  expect(screen.queryByTestId("tree-details-status")?.textContent ?? "").not.toContain(
    hub.tree.statusBadge.invitedLine,
  );
});

/* ── 2. KebabMenu ──────────────────────────────────────────────────────────── */

function openKebab(n: TreeNode, onInvite: (node: TreeNode) => void) {
  render(
    <TreeCallbacksProvider
      value={{
        openAdd: () => {},
        focusPerson: () => {},
        invitePerson: onInvite,
        reconcilePerson: () => {},
      }}
    >
      <KebabMenu node={n} parentCount={0} partnerCount={0} />
    </TreeCallbacksProvider>,
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

it("KebabMenu hides Invite… for pending / not-applicable", () => {
  for (const status of ["pending", "not-applicable"] as const) {
    openKebab(node({ personId: `k-${status}`, inviteStatus: status }), () => {});
    expect(screen.queryByTestId("tree-kebab-invite")).toBeNull();
    cleanup();
  }
});

/* ── 3. TreeCanvas → the in-place PersonInviteModal (#334) ───────────────────── */

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

/** Injected fake for `fetchInviteTargets` — never touches the real DB/auth context. */
async function fakeInviteTargets(): Promise<PersonInviteTargetsResult> {
  return {
    ok: true,
    data: {
      families: [{ id: "FAM-1", name: "The Riccis", shortName: null }],
      seededFamilyId: "FAM-1",
      displayName: "Elena Ricci",
      email: "",
      phone: "",
    },
  };
}

function openElenaKebabInvite() {
  const kebabs = screen.getAllByTestId("tree-kebab-trigger");
  // Trigger every kebab open, then click the invite item that appears (only Elena is invitable).
  for (const k of kebabs) act(() => fireEvent.click(k));
  act(() => fireEvent.click(screen.getByTestId("tree-kebab-invite")));
}

it("kebab Invite opens the in-place PersonInviteModal — the old deep-link is retired", () => {
  render(
    <TreeCanvas
      familyId="FAM-1"
      focusPersonId={FOCUS}
      viewerPersonId={FOCUS}
      initial={selfWithInvitableChild()}
      fetchInviteTargets={fakeInviteTargets}
      submitInvite={vi.fn()}
    />,
  );

  openElenaKebabInvite();

  // TreeCanvas no longer accepts (or uses) a `navigate` prop for this path — the modal is the only
  // possible outcome, so there is nothing left to assert a deep-link DIDN'T happen beyond this.
  const modal = screen.getByTestId("person-invite-modal");
  expect(modal.getAttribute("aria-label")).toBe(hub.personInvite.heading("Elena Ricci"));
});

it("the details-sheet Invite button opens the SAME modal the kebab opens (#334 AC 5)", async () => {
  render(
    <TreeCanvas
      familyId="FAM-1"
      focusPersonId={FOCUS}
      viewerPersonId={FOCUS}
      initial={selfWithInvitableChild()}
      fetchInviteTargets={fakeInviteTargets}
      submitInvite={vi.fn()}
    />,
  );

  fireEvent.doubleClick(screen.getByTestId("tree-node-pos-elena"));
  await screen.findByTestId("tree-person-details");
  fireEvent.click(screen.getByTestId("tree-details-invite"));

  const modal = await screen.findByTestId("person-invite-modal");
  expect(modal.getAttribute("aria-label")).toBe(hub.personInvite.heading("Elena Ricci"));
});

it("a successful send through the modal leaves PersonDetails mounted and open (#334 AC 4)", async () => {
  const submitInvite = vi.fn(
    async (): Promise<PersonInviteFormState> => ({
      status: "sent",
      link: "https://tellmeagain.app/join/tok123",
      sendingTo: null,
    }),
  );
  render(
    <TreeCanvas
      familyId="FAM-1"
      focusPersonId={FOCUS}
      viewerPersonId={FOCUS}
      initial={selfWithInvitableChild()}
      fetchInviteTargets={fakeInviteTargets}
      submitInvite={submitInvite}
    />,
  );

  fireEvent.doubleClick(screen.getByTestId("tree-node-pos-elena"));
  await screen.findByTestId("tree-person-details");
  fireEvent.click(screen.getByTestId("tree-details-invite"));
  await screen.findByTestId("person-invite-modal");

  fireEvent.change(screen.getByPlaceholderText(hub.invite.emailPlaceholder), {
    target: { value: "elena@example.com" },
  });
  fireEvent.change(screen.getByTestId("invite-relationship"), { target: { value: "other" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: hub.invite.sendToEmail }));
  });

  await screen.findByTestId("person-invite-sent");
  expect(screen.getByTestId("tree-person-details")).toBeTruthy();

  // Closing the (now-successful) modal via Done still leaves the details sheet mounted and open.
  fireEvent.click(screen.getByTestId("person-invite-done"));
  expect(screen.queryByTestId("person-invite-modal")).toBeNull();
  expect(screen.getByTestId("tree-person-details")).toBeTruthy();
});
