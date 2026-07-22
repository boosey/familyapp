// @vitest-environment jsdom
/**
 * #289 — line-click governance resolves layout hit refs to actable GovernableKinEdge rows;
 * placeholder endpoints (#259) stay non-actable via core capability flags.
 */
import { describe, expect, it } from "vitest";
import type { GovernableKinEdge } from "@chronicle/core";
import { actableEdgesForHit } from "./line-governance";
import type { ConnectorEdgeRef } from "./tree-layout";

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

describe("actableEdgesForHit (#289)", () => {
  it("returns steward-removable parent_of matching the hit ref", () => {
    const edges = [edge({ personAId: "p", personBId: "c", viewerIsSteward: true, viewerCanRemove: true })];
    const refs: ConnectorEdgeRef[] = [{ edgeType: "parent_of", personAId: "p", personBId: "c" }];
    expect(actableEdgesForHit(edges, refs)).toHaveLength(1);
  });

  it("matches partnered_with regardless of endpoint order", () => {
    const edges = [
      edge({
        edgeType: "partnered_with",
        personAId: "a",
        personBId: "b",
        nature: null,
        viewerCanRemove: true,
      }),
    ];
    const refs: ConnectorEdgeRef[] = [{ edgeType: "partnered_with", personAId: "b", personBId: "a" }];
    expect(actableEdgesForHit(edges, refs)).toHaveLength(1);
  });

  it("returns empty when capability flags are cleared (placeholder scaffold, #259)", () => {
    const edges = [
      edge({
        personAId: "unknown",
        personBId: "kid",
        personAIdentified: false,
        personADisplayName: null,
        viewerIsSteward: false,
        viewerCanRemove: false,
        viewerCanHide: false,
      }),
    ];
    const refs: ConnectorEdgeRef[] = [{ edgeType: "parent_of", personAId: "unknown", personBId: "kid" }];
    expect(actableEdgesForHit(edges, refs)).toHaveLength(0);
  });

  it("does not surface non-matching sibling-like refs (no stored sibling edges)", () => {
    const edges = [edge({ personAId: "p", personBId: "c", viewerCanRemove: true })];
    // Hit refs are only ever parent_of / partnered_with from layout; a stray ref simply misses.
    const refs: ConnectorEdgeRef[] = [{ edgeType: "parent_of", personAId: "sib1", personBId: "sib2" }];
    expect(actableEdgesForHit(edges, refs)).toHaveLength(0);
  });
});
