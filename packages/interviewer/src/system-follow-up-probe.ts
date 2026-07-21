/**
 * SystemFollowUpProbe — deterministic (no LLM) first stage of the follow-up cascade
 * (ADR-0013 amendment). A probe that does not apply returns null (no-op); it must NOT be
 * treated as a "none selected" that blocks later stages. At most one probe kind may win per
 * thread/session via explicit latches owned by the caller (e.g. temporal: once per story).
 */
import type { FollowUpCandidate } from "@chronicle/db";
import type { GapKind } from "./gap-detection";

/**
 * Context the cascade passes to every system probe. Dating fields are optional so probes
 * that need story-dates stay dark until that context is wired (PR #249 hook).
 */
export interface SystemFollowUpProbeContext {
  answerTranscript: string;
  /**
   * Present only when a dating surface has an active story + unresolved date (or interview
   * session with storyDateSink). Absent → temporal probe is N/A.
   */
  dating?: {
    /** True once a temporal follow-up has already been asked this thread/session. */
    alreadyAsked: boolean;
    /** True when the story still has no resolvable date. */
    dateUnresolved: boolean;
  };
}

export interface SystemFollowUpProposal {
  candidate: FollowUpCandidate;
  /** Probe id (also used as ledger modelId prefix material — e.g. temporal → system:story-date). */
  probeId: string;
  /** Phraser angle; for temporal this is always `"temporal"`. */
  gapKind: GapKind;
  /** Fixed provenance id written to the decision ledger (e.g. `system:story-date`). */
  modelId: string;
}

export interface SystemFollowUpProbe {
  /** Stable id for latching / audit (e.g. `"temporal"`). */
  id: string;
  /**
   * Return a proposal when this probe applies; null when N/A (skip to next probe / stage).
   * Must be pure / sync — no I/O, no LLM.
   */
  maybePropose(ctx: SystemFollowUpProbeContext): SystemFollowUpProposal | null;
}
