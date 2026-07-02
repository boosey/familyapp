/**
 * Persisted domain types for narrator AI follow-ups (ADR-0012 / ADR-0013). These are the shared
 * contract: they are stored in the `follow_up_decisions` jsonb/enum columns AND consumed by
 * `@chronicle/interviewer` (evaluator seam + decision logic) and `@chronicle/core` (the append-only
 * repo). They live in `@chronicle/db` because it is the dependency root — no import cycle.
 */

/** The kind of thread a follow-up would pursue. `emotional` is gated by the emotional-door rule. */
export type FollowUpType = "factual" | "sensory" | "temporal" | "relational" | "emotional";

/** How sensitive pursuing this thread is. `high` requires rapport (code gate). */
export type FollowUpSensitivity = "low" | "medium" | "high";

/** One candidate thread the evaluator proposes. Title/summary tier — never raw transcript. */
export interface FollowUpCandidate {
  threadSeed: string;
  type: FollowUpType;
  sensitivity: FollowUpSensitivity;
  /** Model's self-assessed confidence [0..1]. */
  confidence: number;
  /** TRUE iff the narrator's OWN words surfaced the feeling first (emotional-door input). */
  narratorOpened: boolean;
}

/** The coded reason a candidate was kept or dropped — nothing is discarded without one. */
export type FollowUpDispositionReason =
  | "selected"
  | "thin_answer"
  | "distress_shortcircuit"
  | "over_cap_thread"
  | "over_cap_session"
  | "below_confidence"
  | "below_rapport"
  | "duplicate"
  | "emotional_door_closed"
  | "not_selected";

/** One candidate + what the deterministic picker did with it. */
export interface CandidateDisposition {
  candidate: FollowUpCandidate;
  reason: FollowUpDispositionReason;
  selected: boolean;
}

/** What the narrator did with an asked follow-up (the `outcome` row in the ledger). */
export type FollowUpOutcome = "answered" | "skipped" | "off_ramped";

/**
 * The resolved, tunable follow-up policy — snapshotted into each decision record for replay/audit.
 * Shape lives here (persisted); DEFAULT + resolver live in `@chronicle/interviewer`.
 */
export interface FollowUpPolicy {
  enabled: boolean;
  maxFollowUpsPerThread: number;
  maxFollowUpsPerSession: number;
  thinAnswerWordFloor: number;
  confidenceThreshold: number;
}
