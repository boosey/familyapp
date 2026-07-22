// @vitest-environment jsdom
/**
 * #289 — line-click opens existing KinEdgeControls; no menu when flags are cleared (#259).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GovernableKinEdge, KinshipTreeData, TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { TreeCanvas } from "./tree-canvas";

afterEach(cleanup);

vi.mock("./kin-actions", () => ({
  affirmEdgeAction: vi.fn(async () => undefined),
  denyEdgeAction: vi.fn(async () => undefined),
  hideEdgeAction: vi.fn(async () => undefined),
  correctEdgeAction: vi.fn(async () => undefined),
}));

vi.mock("./actions", () => ({
  fetchSubtreeAction: vi.fn(async () => ({ ok: false })),
}));

function treeNode(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? over.personId,
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

function govEdge(
  over: Partial<GovernableKinEdge> & Pick<GovernableKinEdge, "personAId" | "personBId" | "edgeType">,
): GovernableKinEdge {
  return {
    edgeType: over.edgeType,
    personAId: over.personAId,
    personBId: over.personBId,
    personADisplayName: over.personADisplayName ?? "A",
    personAIdentified: over.personAIdentified ?? true,
    personBDisplayName: over.personBDisplayName ?? "B",
    personBIdentified: over.personBIdentified ?? true,
    nature: over.nature ?? (over.edgeType === "parent_of" ? "unknown" : null),
    state: over.state ?? "asserted",
    assertedBy: over.assertedBy ?? over.personAId,
    viewerIsSteward: over.viewerIsSteward ?? false,
    viewerCanHide: over.viewerCanHide ?? false,
    viewerCanRemove: over.viewerCanRemove ?? false,
  };
}

function treeData(): KinshipTreeData {
  const t0 = new Date("2026-01-01T00:00:00Z");
  return {
    familyId: "F",
    rootPersonId: "me",
    nodes: [
      treeNode({ personId: "me", displayName: "Me", sex: "male", relationToRoot: "self" }),
      treeNode({ personId: "spouse", displayName: "Spouse", sex: "female" }),
      treeNode({ personId: "kid", displayName: "Kid" }),
    ],
    edges: [
      {
        edgeType: "partnered_with",
        personAId: "me",
        personBId: "spouse",
        nature: null,
        state: "asserted",
        assertedBy: "me",
        assertedAt: t0,
        updatedAt: t0,
      },
      {
        edgeType: "parent_of",
        personAId: "me",
        personBId: "kid",
        nature: "biological",
        state: "asserted",
        assertedBy: "me",
        assertedAt: t0,
        updatedAt: t0,
      },
      {
        edgeType: "parent_of",
        personAId: "spouse",
        personBId: "kid",
        nature: "biological",
        state: "asserted",
        assertedBy: "me",
        assertedAt: t0,
        updatedAt: t0,
      },
    ],
  };
}

describe("TreeCanvas line-click governance (#289)", () => {
  it("opens KinEdgeControls when an actable parent/partner hit is clicked", () => {
    render(
      <TreeCanvas
        familyId="F"
        focusPersonId="me"
        viewerPersonId="me"
        initial={treeData()}
        governableEdges={[
          govEdge({
            edgeType: "partnered_with",
            personAId: "me",
            personBId: "spouse",
            personADisplayName: "Me",
            personBDisplayName: "Spouse",
            viewerIsSteward: true,
            viewerCanRemove: true,
          }),
          govEdge({
            edgeType: "parent_of",
            personAId: "me",
            personBId: "kid",
            personADisplayName: "Me",
            personBDisplayName: "Kid",
            viewerIsSteward: true,
            viewerCanRemove: true,
          }),
          govEdge({
            edgeType: "parent_of",
            personAId: "spouse",
            personBId: "kid",
            personADisplayName: "Spouse",
            personBDisplayName: "Kid",
            viewerIsSteward: true,
            viewerCanRemove: true,
          }),
        ]}
      />,
    );

    const hits = screen.getAllByTestId("tree-edge-hit");
    expect(hits.length).toBeGreaterThan(0);
    fireEvent.click(hits[0]!);
    expect(screen.getByTestId("tree-line-gov-menu")).toBeTruthy();
    expect(screen.getByRole("button", { name: hub.kin.deny })).toBeTruthy();
  });

  it("does not open a menu when hit edges have no stewardship affordances (#259)", () => {
    render(
      <TreeCanvas
        familyId="F"
        focusPersonId="me"
        viewerPersonId="me"
        initial={treeData()}
        governableEdges={[
          govEdge({
            edgeType: "partnered_with",
            personAId: "me",
            personBId: "spouse",
            viewerIsSteward: false,
            viewerCanRemove: false,
            viewerCanHide: false,
          }),
          govEdge({
            edgeType: "parent_of",
            personAId: "me",
            personBId: "kid",
            viewerIsSteward: false,
            viewerCanRemove: false,
            viewerCanHide: false,
          }),
          govEdge({
            edgeType: "parent_of",
            personAId: "spouse",
            personBId: "kid",
            viewerIsSteward: false,
            viewerCanRemove: false,
            viewerCanHide: false,
          }),
        ]}
      />,
    );

    for (const hit of screen.getAllByTestId("tree-edge-hit")) {
      fireEvent.click(hit);
    }
    expect(screen.queryByTestId("tree-line-gov-menu")).toBeNull();
  });
});
