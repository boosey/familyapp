/**
 * #289 — resolve layout edge-hit refs to actable GovernableKinEdge rows (capability flags from core).
 */
import type { GovernableKinEdge } from "@chronicle/core";
import { actableEdges } from "../kin/edge-sentence";
import type { ConnectorEdgeRef } from "./tree-layout";

function refsMatch(edge: GovernableKinEdge, ref: ConnectorEdgeRef): boolean {
  if (edge.edgeType !== ref.edgeType) return false;
  if (edge.personAId === ref.personAId && edge.personBId === ref.personBId) return true;
  // partnered_with is undirected — layout may normalize A/B differently from the ledger row.
  if (ref.edgeType === "partnered_with") {
    return edge.personAId === ref.personBId && edge.personBId === ref.personAId;
  }
  return false;
}

/** Actable governable edges matching any of the hit-target refs (deduped). */
export function actableEdgesForHit(
  governableEdges: readonly GovernableKinEdge[],
  refs: readonly ConnectorEdgeRef[],
): GovernableKinEdge[] {
  const matched = governableEdges.filter((e) => refs.some((r) => refsMatch(e, r)));
  return actableEdges(matched);
}
