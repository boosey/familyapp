/**
 * Ungendered edge sentence for the governance UI (#33/#34, re-homed in #254). Shared by PersonDetails
 * and the Family List relationships section so both surfaces speak the same copy.
 */
import type { GovernableKinEdge } from "@chronicle/core";
import { hub } from "@/app/_copy";

function endpointName(displayName: string | null, identified: boolean): string {
  const trimmed = displayName?.trim();
  if (identified && trimmed) return trimmed;
  return hub.kin.edgeUnknownPerson;
}

/** One-line sentence for a visible kinship edge (parent_of / partnered_with). */
export function edgeSentence(edge: GovernableKinEdge): string {
  const a = endpointName(edge.personADisplayName, edge.personAIdentified);
  const b = endpointName(edge.personBDisplayName, edge.personBIdentified);
  if (edge.edgeType === "parent_of") return hub.kin.edgeParentOf(a, b);
  return hub.kin.edgePartneredWith(a, b);
}

/** Stable React key matching the layout/merge edge identity. */
export function governableEdgeKey(edge: GovernableKinEdge): string {
  return `${edge.edgeType}:${edge.personAId}:${edge.personBId}`;
}

/** Edges the viewer can act on (steward and/or subject-hide) that touch `personId`. */
export function actableEdgesForPerson(
  edges: readonly GovernableKinEdge[],
  personId: string,
): GovernableKinEdge[] {
  return edges.filter(
    (e) =>
      (e.personAId === personId || e.personBId === personId) &&
      (e.viewerIsSteward || e.viewerCanHide),
  );
}

/** Edges the viewer can act on anywhere in the family (List-view governance section). */
export function actableEdges(edges: readonly GovernableKinEdge[]): GovernableKinEdge[] {
  return edges.filter((e) => e.viewerIsSteward || e.viewerCanHide);
}
