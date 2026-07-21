// @vitest-environment jsdom
/**
 * #254/#255 — PersonDetails re-homes steward Remove / subject Hide / nature correct from the dead
 * kin page onto the tree details sheet. Capability flags come from `listGovernableKinEdges`
 * (threaded as `governableEdges`); the sheet only lists edges that touch the opened person AND that
 * the viewer can act on.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GovernableKinEdge, TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { PersonDetails } from "./person-details";
import type { PersonEditabilityResult, SavePersonEditResult } from "./actions";

afterEach(cleanup);

vi.mock("../kin/actions", () => ({
  affirmEdgeAction: vi.fn(async () => undefined),
  denyEdgeAction: vi.fn(async () => undefined),
  hideEdgeAction: vi.fn(async () => undefined),
  correctEdgeAction: vi.fn(async () => undefined),
}));

import { affirmEdgeAction, correctEdgeAction, denyEdgeAction, hideEdgeAction } from "../kin/actions";

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? null,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    birthYear: over.birthYear ?? null,
    deathYear: over.deathYear ?? null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: over.sex ?? "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
  };
}

function edge(over: Partial<GovernableKinEdge> & Pick<GovernableKinEdge, "personAId" | "personBId">): GovernableKinEdge {
  return {
    edgeType: over.edgeType ?? "parent_of",
    personAId: over.personAId,
    personBId: over.personBId,
    personADisplayName: over.personADisplayName ?? "Alice",
    personAIdentified: over.personAIdentified ?? true,
    personBDisplayName: over.personBDisplayName ?? "Bob",
    personBIdentified: over.personBIdentified ?? true,
    nature: over.nature ?? "unknown",
    state: over.state ?? "asserted",
    assertedBy: over.assertedBy ?? over.personAId,
    viewerIsSteward: over.viewerIsSteward ?? false,
    viewerCanHide: over.viewerCanHide ?? false,
    viewerCanRemove: over.viewerCanRemove ?? over.viewerIsSteward ?? false,
  };
}

const editableNo = async (): Promise<PersonEditabilityResult> => ({ ok: true, editable: false });
const saveOk = async (): Promise<SavePersonEditResult> => ({ ok: true });

function renderDetails(governableEdges: GovernableKinEdge[], personId = "bob") {
  const onEdgeGoverned = vi.fn();
  render(
    <PersonDetails
      node={node({ personId, displayName: personId === "bob" ? "Bob" : "Alice" })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      checkEditable={editableNo}
      saveEdit={saveOk}
      governableEdges={governableEdges}
      onEdgeGoverned={onEdgeGoverned}
    />,
  );
  return { onEdgeGoverned };
}

it("shows Remove for a steward on an edge touching the opened person", async () => {
  renderDetails([
    edge({ personAId: "alice", personBId: "bob", viewerIsSteward: true }),
  ]);
  expect(await screen.findByTestId("tree-details-gov-edges")).toBeTruthy();
  expect(screen.getByText(hub.kin.edgeParentOf("Alice", "Bob"))).toBeTruthy();
  expect(screen.getByRole("button", { name: hub.kin.deny })).toBeTruthy();
  expect(screen.queryByRole("button", { name: hub.kin.hide })).toBeNull();
});

it("shows Hide when the viewer is a self-account endpoint (not steward)", async () => {
  renderDetails([
    edge({ personAId: "alice", personBId: "bob", viewerCanHide: true }),
  ]);
  expect(await screen.findByTestId("tree-details-gov-edges")).toBeTruthy();
  expect(screen.getByRole("button", { name: hub.kin.hide })).toBeTruthy();
  expect(screen.queryByRole("button", { name: hub.kin.deny })).toBeNull();
});

it("shows both Remove and Hide when the steward is also an endpoint", async () => {
  renderDetails([
    edge({
      personAId: "alice",
      personBId: "bob",
      viewerIsSteward: true,
      viewerCanHide: true,
    }),
  ]);
  expect(await screen.findByRole("button", { name: hub.kin.deny })).toBeTruthy();
  expect(screen.getByRole("button", { name: hub.kin.hide })).toBeTruthy();
});

it("#256: shows Remove for the original asserter even when not steward", async () => {
  renderDetails([
    edge({ personAId: "alice", personBId: "bob", viewerIsSteward: false, viewerCanRemove: true }),
  ]);
  expect(await screen.findByTestId("tree-details-gov-edges")).toBeTruthy();
  expect(screen.getByRole("button", { name: hub.kin.deny })).toBeTruthy();
});

it("#256: hides Remove for a viewer who is neither steward nor asserter (Charlie)", async () => {
  renderDetails([
    edge({ personAId: "alice", personBId: "bob", viewerIsSteward: false, viewerCanRemove: false }),
  ]);
  await waitFor(() => expect(screen.queryByTestId("tree-details-gov-edges")).toBeNull());
  expect(screen.queryByRole("button", { name: hub.kin.deny })).toBeNull();
});

it("hides the governance section when the viewer can neither Remove nor Hide", async () => {
  renderDetails([
    edge({ personAId: "alice", personBId: "bob" }),
  ]);
  await waitFor(() => expect(screen.queryByTestId("tree-details-gov-edges")).toBeNull());
  expect(screen.queryByRole("button", { name: hub.kin.deny })).toBeNull();
  expect(screen.queryByRole("button", { name: hub.kin.hide })).toBeNull();
});

it("ignores edges that do not touch the opened person", async () => {
  renderDetails(
    [
      edge({
        personAId: "carol",
        personBId: "dave",
        personADisplayName: "Carol",
        personBDisplayName: "Dave",
        viewerIsSteward: true,
      }),
    ],
    "bob",
  );
  await waitFor(() => expect(screen.queryByTestId("tree-details-gov-edges")).toBeNull());
});

it("calls onEdgeGoverned with deny after a successful Remove", async () => {
  const e = edge({ personAId: "alice", personBId: "bob", viewerIsSteward: true });
  const { onEdgeGoverned } = renderDetails([e]);
  fireEvent.click(await screen.findByRole("button", { name: hub.kin.deny }));
  await waitFor(() => expect(denyEdgeAction).toHaveBeenCalled());
  await waitFor(() => expect(onEdgeGoverned).toHaveBeenCalledWith(e, "deny"));
});

it("calls onEdgeGoverned with hide after a successful Hide", async () => {
  const e = edge({ personAId: "alice", personBId: "bob", viewerCanHide: true });
  const { onEdgeGoverned } = renderDetails([e]);
  fireEvent.click(await screen.findByRole("button", { name: hub.kin.hide }));
  await waitFor(() => expect(hideEdgeAction).toHaveBeenCalled());
  await waitFor(() => expect(onEdgeGoverned).toHaveBeenCalledWith(e, "hide"));
});

it("calls onEdgeGoverned with affirm after Endorse (must not be treated as a prune)", async () => {
  const e = edge({ personAId: "alice", personBId: "bob", viewerIsSteward: true, state: "asserted" });
  const { onEdgeGoverned } = renderDetails([e]);
  fireEvent.click(await screen.findByRole("button", { name: hub.kin.affirm }));
  await waitFor(() => expect(affirmEdgeAction).toHaveBeenCalled());
  await waitFor(() => expect(onEdgeGoverned).toHaveBeenCalledWith(e, "affirm"));
});

it("shows nature picker for steward on parent_of and submits correctEdgeAction (#255)", async () => {
  const e = edge({
    personAId: "alice",
    personBId: "bob",
    viewerIsSteward: true,
    nature: "biological",
  });
  const { onEdgeGoverned } = renderDetails([e]);
  expect(await screen.findByTestId("kin-edge-correct-nature")).toBeTruthy();
  const select = screen.getByLabelText(hub.kin.natureFieldLabel) as HTMLSelectElement;
  expect(select.value).toBe("biological");
  fireEvent.change(select, { target: { value: "adoptive" } });
  fireEvent.click(screen.getByRole("button", { name: hub.kin.correct }));
  await waitFor(() => expect(correctEdgeAction).toHaveBeenCalled());
  const formData = (correctEdgeAction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as FormData;
  expect(formData.get("nature")).toBe("adoptive");
  await waitFor(() => expect(onEdgeGoverned).toHaveBeenCalledWith(e, "correct"));
});

it("does not show nature picker on partner edges or for non-stewards (#255)", async () => {
  renderDetails([
    edge({
      personAId: "alice",
      personBId: "bob",
      edgeType: "partnered_with",
      nature: null,
      viewerIsSteward: true,
    }),
  ]);
  expect(await screen.findByRole("button", { name: hub.kin.deny })).toBeTruthy();
  expect(screen.queryByTestId("kin-edge-correct-nature")).toBeNull();

  cleanup();
  renderDetails([
    edge({ personAId: "alice", personBId: "bob", viewerCanHide: true, nature: "biological" }),
  ]);
  expect(await screen.findByRole("button", { name: hub.kin.hide })).toBeTruthy();
  expect(screen.queryByTestId("kin-edge-correct-nature")).toBeNull();
  expect(screen.queryByRole("button", { name: hub.kin.correct })).toBeNull();
});
