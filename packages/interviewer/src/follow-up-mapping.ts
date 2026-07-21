/**
 * FollowUpType ↔ GapKind mapping — the single place both directions live.
 *
 * Forward (GapKind → FollowUpType): gap detection maps each missing-fact kind onto the persisted
 * candidate type. temporal/relational have exact peers; spatial/causal/identity collapse to
 * `factual` (gap follow-ups are factual by construction — they fill missing facts, never open an
 * emotional door).
 *
 * Reverse (FollowUpType → GapKind): lossy by construction — used ONLY to give the phraser a
 * phrasing angle when a candidate's original GapKind was not preserved. `factual` reverses to
 * `identity` (the most neutral "what/which" angle). Never treat the reverse as authoritative fact.
 */
import type { FollowUpType } from "@chronicle/db";
import type { GapKind } from "./gap-detection";

export const GAP_KIND_TO_FOLLOW_UP_TYPE: Record<GapKind, FollowUpType> = {
  temporal: "temporal",
  relational: "relational",
  spatial: "factual",
  causal: "factual",
  identity: "factual",
};

export const FOLLOW_UP_TYPE_TO_GAP_KIND: Record<FollowUpType, GapKind> = {
  temporal: "temporal",
  relational: "relational",
  factual: "identity",
  sensory: "identity",
  emotional: "identity",
};
