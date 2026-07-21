import { expect, it } from "vitest";
import type { GovernableKinEdge } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { actableEdges, actableEdgesForPerson, edgeSentence } from "./edge-sentence";

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

it("formats parent_of and partnered_with sentences", () => {
  expect(edgeSentence(edge({ personAId: "a", personBId: "b" }))).toBe(
    hub.kin.edgeParentOf("Alice", "Bob"),
  );
  expect(
    edgeSentence(edge({ personAId: "a", personBId: "b", edgeType: "partnered_with", nature: null })),
  ).toBe(hub.kin.edgePartneredWith("Alice", "Bob"));
});

it("includes known nature in parent_of sentences (#255)", () => {
  expect(edgeSentence(edge({ personAId: "a", personBId: "b", nature: "adoptive" }))).toBe(
    hub.kin.edgeParentOfNature("Alice", hub.kin.natureLabel.adoptive, "Bob"),
  );
  expect(edgeSentence(edge({ personAId: "a", personBId: "b", nature: "unknown" }))).toBe(
    hub.kin.edgeParentOf("Alice", "Bob"),
  );
});

it("uses the unnamed fallback for unidentified endpoints", () => {
  expect(
    edgeSentence(
      edge({
        personAId: "a",
        personBId: "b",
        personADisplayName: null,
        personAIdentified: false,
      }),
    ),
  ).toBe(hub.kin.edgeParentOf(hub.kin.edgeUnknownPerson, "Bob"));
});

it("filters actable edges for a person vs family-wide", () => {
  const edges = [
    edge({ personAId: "alice", personBId: "bob", viewerIsSteward: true, viewerCanRemove: true }),
    edge({ personAId: "carol", personBId: "dave", viewerCanHide: true }),
    edge({ personAId: "alice", personBId: "erin" }),
  ];
  expect(actableEdgesForPerson(edges, "bob")).toHaveLength(1);
  expect(actableEdges(edges)).toHaveLength(2);
});

it("#256: includes an asserter-retract edge (viewerCanRemove, not steward) as actable, excludes a non-actable edge", () => {
  const edges = [
    // Alice asserted this edge herself; she is not the steward but may retract it.
    edge({
      personAId: "alice",
      personBId: "bob",
      viewerIsSteward: false,
      viewerCanRemove: true,
    }),
    // Charlie is neither steward nor asserter — cannot act on this edge.
    edge({
      personAId: "carol",
      personBId: "dave",
      viewerIsSteward: false,
      viewerCanRemove: false,
      viewerCanHide: false,
    }),
  ];
  expect(actableEdgesForPerson(edges, "alice")).toHaveLength(1);
  expect(actableEdges(edges)).toHaveLength(1);
});
