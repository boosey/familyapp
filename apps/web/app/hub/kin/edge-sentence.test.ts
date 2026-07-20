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
    viewerIsSteward: over.viewerIsSteward ?? false,
    viewerCanHide: over.viewerCanHide ?? false,
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
    edge({ personAId: "alice", personBId: "bob", viewerIsSteward: true }),
    edge({ personAId: "carol", personBId: "dave", viewerCanHide: true }),
    edge({ personAId: "alice", personBId: "erin" }),
  ];
  expect(actableEdgesForPerson(edges, "bob")).toHaveLength(1);
  expect(actableEdges(edges)).toHaveLength(2);
});
